'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { inngest } from '@/lib/inngest/client'
import {
  bindPolicy,
  createRun,
  recordHumanAction,
  saveCaseFile,
  uploadAttachment,
} from '@/lib/db/runs'
import { emptyCaseFile, type AttachmentManifestItem } from '@/lib/underwriting/case-file'
import { classifyAttachment } from '@/lib/services/doc-parser'
import { getThread } from '@/lib/services/gmail'

/**
 * Start a demo run. Phase 0: there is no real upload yet, so this seeds a run
 * from one of the synthetic scenarios and enqueues the orchestrator (which runs
 * stub nodes that only emit events). Phase 1 wires the real `.eml`/PDF/xlsx
 * intake; the scenario label is what the orchestrator resolves to a packet.
 */
const SCENARIOS: Record<string, string> = {
  clean: 'Northwind Logistics LLC — GL new business (clean)',
  referral: 'Apex Demolition Inc — GL new business (referral)',
  gappy: 'Riverside Catering Co — GL new business (missing fields)',
}

export async function startDemoRun(formData: FormData): Promise<void> {
  const scenario = String(formData.get('scenario') ?? 'clean')
  const submissionLabel = SCENARIOS[scenario] ?? SCENARIOS.clean

  const { id, slug } = await createRun({ submissionLabel, scenario })
  await inngest.send({
    name: 'underwriting/run-requested',
    data: { runId: id },
  })

  revalidatePath('/dashboard')
  redirect(`/dashboard/runs/${slug}`)
}

const MAX_FILES = 12
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB per file

/** A Gmail thread the composer added as a document source. `keep` are the
 *  attachment filenames the user left in the document list (others were removed). */
interface GmailSourceInput {
  threadId: string
  permalink?: string
  keep: string[]
}

function parseGmailSources(raw: string): GmailSourceInput[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s): s is GmailSourceInput => s && typeof s.threadId === 'string')
      .map((s) => ({
        threadId: s.threadId,
        permalink: typeof s.permalink === 'string' ? s.permalink : undefined,
        keep: Array.isArray(s.keep) ? s.keep.filter((k) => typeof k === 'string') : [],
      }))
  } catch {
    return []
  }
}

/**
 * Start a run from one submission composed of any mix of locally-uploaded files
 * and connected Gmail threads. Every document — uploaded or pulled from Gmail —
 * lands in the `submissions` bucket and the attachment manifest; the broker info
 * and cover note seed the Case File. The intake agent classifies each file's kind;
 * everything downstream — extraction, gap, appetite, pricing, compliance — is
 * unchanged regardless of where a document came from.
 *
 * This is the production-shaped entry point: swap this form for an inbound email
 * webhook and the rest of the pipeline does not move.
 */
export async function startSubmissionRun(formData: FormData): Promise<void> {
  const brokerName = String(formData.get('brokerName') ?? '').trim()
  const brokerEmail = String(formData.get('brokerEmail') ?? '').trim()
  const insuredName = String(formData.get('insuredName') ?? '').trim()
  const coverLetter = String(formData.get('coverLetter') ?? '').trim()

  const files = formData
    .getAll('files')
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_FILES)
  const gmailSources = parseGmailSources(String(formData.get('gmailThreads') ?? ''))

  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      throw new Error(`${f.name} is too large (max 25 MB).`)
    }
  }

  // Fetch the Gmail document bytes now (the composer only had their names). Only
  // the attachments the user kept in the list are pulled.
  const gmailDocs: { filename: string; mime: string; bytes: Uint8Array }[] = []
  for (const src of gmailSources) {
    const keep = new Set(src.keep)
    if (keep.size === 0) continue
    const thread = await getThread(src.threadId)
    for (const a of thread.attachments) {
      if (!keep.has(a.filename) || a.bytes.length === 0) continue
      if (a.bytes.length > MAX_FILE_BYTES) {
        throw new Error(`${a.filename} is too large (max 25 MB).`)
      }
      gmailDocs.push({ filename: a.filename, mime: a.mimeType || 'application/octet-stream', bytes: a.bytes })
    }
  }

  const totalDocs = files.length + gmailDocs.length
  if (totalDocs === 0 && !coverLetter) {
    throw new Error('Add at least one document — upload a file or import from Gmail — or include a cover note.')
  }

  const submissionLabel = insuredName || brokerName || 'GL submission'
  const { id, slug } = await createRun({ submissionLabel, scenario: 'upload' })

  const manifest: AttachmentManifestItem[] = []

  // Locally-uploaded files.
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer())
    const mime = f.type || 'application/octet-stream'
    const storagePath = await uploadAttachment({ runSlug: slug, filename: f.name, bytes, contentType: mime })
    manifest.push({
      filename: f.name,
      // Provisional; the intake agent refines this with the LLM classifier.
      kind: classifyAttachment(f.name, mime),
      mime,
      storagePath,
      sizeBytes: bytes.length,
    })
  }

  // Documents pulled from Gmail threads — ingested identically to uploads.
  for (const d of gmailDocs) {
    const storagePath = await uploadAttachment({ runSlug: slug, filename: d.filename, bytes: d.bytes, contentType: d.mime })
    manifest.push({
      filename: d.filename,
      kind: classifyAttachment(d.filename, d.mime),
      mime: d.mime,
      storagePath,
      sizeBytes: d.bytes.length,
    })
  }

  // A cover note (typed, or hydrated from an imported email body) becomes a real
  // cover_letter.txt attachment, so the extraction agent reads it like any other doc.
  if (coverLetter) {
    const bytes = new TextEncoder().encode(coverLetter)
    const storagePath = await uploadAttachment({
      runSlug: slug,
      filename: 'cover_letter.txt',
      bytes,
      contentType: 'text/plain',
    })
    manifest.push({
      filename: 'cover_letter.txt',
      kind: 'cover_letter',
      mime: 'text/plain',
      storagePath,
      sizeBytes: bytes.length,
    })
  }

  // Pre-seed the Case File the orchestrator will pick up (it reads row.case_file).
  const caseFile = emptyCaseFile(slug)
  caseFile.submission.broker = {
    name: brokerName || undefined,
    email: brokerEmail || undefined,
  }
  if (insuredName) caseFile.submission.insured = { name: insuredName }
  // Record the originating Gmail thread (the first, when several) for traceability.
  const primaryGmail = gmailSources.find((s) => s.keep.length > 0) ?? gmailSources[0]
  if (primaryGmail) {
    caseFile.submission.source = {
      type: 'gmail',
      threadId: primaryGmail.threadId,
      permalink: primaryGmail.permalink,
    }
  }
  caseFile.attachments = manifest
  await saveCaseFile(id, caseFile)

  await inngest.send({ name: 'underwriting/run-requested', data: { runId: id } })

  revalidatePath('/dashboard')
  redirect(`/dashboard/runs/${slug}`)
}

/**
 * Bind the quote — a GATED action. Writes a demo policy record (the PAS
 * integration point in production) and logs the human action. Optional
 * `overridePremium` lets the underwriter adjust the bound premium first.
 */
export async function bindQuote(
  runId: string,
  overridePremium?: number,
): Promise<{ policyNumber: string }> {
  if (overridePremium != null && Number.isFinite(overridePremium)) {
    await recordHumanAction(runId, 'override_field', {
      field: 'quote.premium',
      value: overridePremium,
    })
  }
  const policyNumber = await bindPolicy(runId)
  await recordHumanAction(runId, 'bind', { policyNumber })
  return { policyNumber }
}

/**
 * Respond to the broker-email send gate. Resumes the parked orchestrator step
 * via the human-approval event; the worker sends to the demo outbox (or skips)
 * and continues the pipeline.
 */
export async function respondBrokerEmail(
  runId: string,
  approved: boolean,
): Promise<void> {
  await inngest.send({
    name: 'underwriting/human-approval',
    data: { runId, gate: 'broker_email', approved },
  })
}
