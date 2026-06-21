import { events } from '@/lib/events/emit'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { buildAndUploadPacket } from '@/lib/demo/build-packet'
import { downloadAttachment } from '@/lib/db/runs'
import {
  bytesToText,
  pdfToText,
  xlsxToText,
} from '@/lib/services/doc-parser'
import { classifyAttachments, type ClassifyInput } from './classify'

/**
 * Intake Agent — receive the broker submission, inventory + classify the
 * attachments, and open the case.
 *
 * Two paths, same output (a classified attachment manifest the extraction agent
 * then reads):
 *   - scenario runs (clean | referral | gappy) materialize a synthetic packet
 *     into real files (PDFs + xlsx) in Storage.
 *   - `upload` runs receive files a carrier actually dropped in: the broker info
 *     and manifest are pre-seeded on the Case File by the upload action, and the
 *     intake agent classifies each file's document kind with the LLM.
 */
export async function runIntake(
  runId: string,
  runSlug: string,
  scenario: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  if (scenario === 'upload' || scenario === 'gmail')
    return runUploadIntake(runId, caseFile)

  await events.entered(runId, 'intake', 'Receiving broker submission')
  await events.activity(runId, 'intake', 'Reading broker email', 0.2)

  const { packet, manifest } = await buildAndUploadPacket(runSlug, scenario)

  await events.activity(
    runId,
    'intake',
    `Classifying ${manifest.length} attachments`,
    0.6,
  )
  for (const a of manifest) {
    await events.activity(runId, 'intake', `${a.filename} → ${a.kind}`, 0.8)
  }

  caseFile.submission.broker = {
    name: packet.broker.name,
    email: packet.broker.email,
  }
  caseFile.attachments = manifest
  caseFile.status = 'extracting'

  await events.output(runId, 'intake', `Case opened — ${manifest.length} documents`, {
    broker: caseFile.submission.broker,
    attachments: manifest.map((m) => ({ filename: m.filename, kind: m.kind })),
  })
  await events.completed(
    runId,
    'intake',
    `${manifest.length} documents classified`,
    `${manifest.length} docs`,
  )
  return caseFile
}

const PREVIEW_BYTES = 24_000

/**
 * Real-upload intake. The broker fields and the raw attachment manifest were
 * pre-seeded on the Case File by `startSubmissionRun` (files already in Storage).
 * Here we download a text preview of each file, classify its document kind with
 * the LLM, and write the kinds back. The extraction agent then reads these exact
 * files — the same storage → download → parse path the synthetic packets use.
 */
async function runUploadIntake(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'intake', 'Receiving broker submission')

  const broker = caseFile.submission.broker
  if (broker?.name || broker?.email) {
    await events.activity(
      runId,
      'intake',
      `From ${broker.name ?? broker.email}`,
      0.2,
    )
  }

  const inputs: ClassifyInput[] = []
  for (const att of caseFile.attachments) {
    await events.activity(runId, 'intake', `Reading ${att.filename}`, 0.4)
    let preview = ''
    try {
      const bytes = new Uint8Array(await downloadAttachment(att.storagePath))
      if (att.mime === 'application/pdf') {
        preview = pdfToText(bytes)
      } else if (
        att.mime.includes('spreadsheet') ||
        att.filename.toLowerCase().endsWith('.xlsx')
      ) {
        preview = xlsxToText(bytes)
      } else {
        preview = bytesToText(bytes)
      }
    } catch {
      // Unreadable preview is fine; the classifier falls back to the filename.
    }
    inputs.push({
      filename: att.filename,
      mime: att.mime,
      preview: preview.slice(0, PREVIEW_BYTES),
    })
  }

  await events.toolStarted(runId, 'intake', 'classify_attachments')
  const kinds = await classifyAttachments(inputs)
  await events.toolCompleted(runId, 'intake', 'classify_attachments')

  caseFile.attachments = caseFile.attachments.map((att) => ({
    ...att,
    kind: kinds[att.filename] ?? att.kind,
  }))
  caseFile.status = 'extracting'

  for (const att of caseFile.attachments) {
    await events.activity(runId, 'intake', `${att.filename} → ${att.kind}`, 0.85)
  }

  await events.output(runId, 'intake', `Case opened — ${caseFile.attachments.length} documents`, {
    broker: caseFile.submission.broker,
    attachments: caseFile.attachments.map((m) => ({
      filename: m.filename,
      kind: m.kind,
    })),
  })
  await events.completed(
    runId,
    'intake',
    `${caseFile.attachments.length} documents classified`,
    `${caseFile.attachments.length} docs`,
  )
  return caseFile
}
