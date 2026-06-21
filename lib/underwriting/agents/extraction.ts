import { events } from '@/lib/events/emit'
import { runTool, type PdfAttachment } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import { downloadAttachment } from '@/lib/db/runs'
import type { CaseFile } from '@/lib/underwriting/case-file'
import {
  EXTRACTION_TOOL_INPUT_SCHEMA,
  ExtractionResultSchema,
} from '@/lib/underwriting/schema'
import {
  bytesToBase64,
  bytesToText,
  pdfToText,
  pdfVisionEnabled,
  xlsxToText,
} from '@/lib/services/doc-parser'
import { formatCurrency } from '@/lib/format'

const LOW_CONFIDENCE = 0.6
const EXTRACTION_SYSTEM = `# This call: DOCUMENT EXTRACTION

You are converting a broker's General Liability submission into a structured Case File. The documents are attached (PDFs) and/or quoted below (loss-run workbook flattened to CSV, broker cover letter).

## What to do
- Read every document. Extract the insured identity, requested coverage, rating exposures, and the full prior loss history.
- For each value, record an honest confidence (0..1) and a source pointer (file name, plus page for PDFs or cell for the loss workbook where you can).
- Emit a flat \`fields\` array covering at least: insured.name, insured.fein, insured.naics, insured.address, insured.yearsInBusiness, coverage.occurrenceLimit, coverage.aggregateLimit, coverage.deductible, coverage.requestedEffectiveDate.

## What you do NOT do
- Do not invent any value. If the documents do not state it, set it to null and give it confidence 0. Missing data is a finding for the next agent, not something to guess.
- Do not compute or editorialize. Just extract what is present.`

/**
 * Extraction Agent (the hero shot). Downloads the classified attachments,
 * sends PDFs to the open vision model as page images (handles scans too) or
 * flattens them to text when no vision model is set, flattens the loss-run
 * workbook + cover letter to text, and emits the structured Case
 * File with per-field confidence and source pointers. Low-confidence fields are
 * flagged for the underwriter.
 */
export async function runExtraction(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'extraction', 'Opening submission documents')

  // With a vision model configured (LLM_VISION_MODEL), PDFs are sent to the model
  // as page images (handles scans). Otherwise (text-only DeepSeek) they're
  // flattened to text first.
  const nativePdf = pdfVisionEnabled()
  const pdfs: PdfAttachment[] = []
  const textBlocks: string[] = []
  // PDFs that flattened to no text in text-only mode. Captured at read time —
  // the most reliable "we ran blind on this document" signal we have.
  const emptyTextPdfs: string[] = []

  for (const att of caseFile.attachments) {
    await events.activity(runId, 'extraction', `Reading ${att.filename}`, 0.3)
    const bytes = new Uint8Array(await downloadAttachment(att.storagePath))
    if (att.mime === 'application/pdf') {
      if (nativePdf) {
        pdfs.push({ base64: bytesToBase64(bytes), label: att.filename })
      } else {
        const text = pdfToText(bytes)
        if (text.trim().length < 20) {
          emptyTextPdfs.push(att.filename)
        }
        textBlocks.push(
          `## ${att.filename}\n${text || '[no extractable text in PDF]'}`,
        )
        await events.activity(runId, 'extraction', `Parsing ${att.filename}`, 0.4)
      }
    } else if (att.kind === 'loss_run') {
      const csv = xlsxToText(bytes)
      textBlocks.push(`## ${att.filename} (loss run)\n${csv}`)
      await events.activity(runId, 'extraction', `Parsing loss run ${att.filename}`, 0.45)
    } else {
      textBlocks.push(`## ${att.filename}\n${bytesToText(bytes)}`)
    }
  }

  await events.toolStarted(runId, 'extraction', 'emit_extraction')

  const docsNote = nativePdf
    ? 'Some documents are attached as PDFs; others are quoted below.'
    : 'All documents are quoted below as text (extracted from the PDFs / workbook).'
  const userPrompt = `${docsNote}

${textBlocks.join('\n\n')}

# Your task
Read every document and call the \`emit_extraction\` tool exactly once with the structured Case File.`

  const result = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: EXTRACTION_SYSTEM }],
    userPrompt,
    toolName: 'emit_extraction',
    toolDescription:
      'Emit the structured extraction: insured, coverage, exposures, loss history, and a flat fields array with confidence + source. Call exactly once.',
    toolInputSchema: EXTRACTION_TOOL_INPUT_SCHEMA,
    schema: ExtractionResultSchema,
    callLabel: 'extraction',
    pdfs,
  })

  await events.toolCompleted(runId, 'extraction', 'emit_extraction')

  // Fold into the Case File.
  caseFile.submission.insured = {
    name: result.insured.name ?? undefined,
    fein: result.insured.fein ?? undefined,
    naics: result.insured.naics ?? undefined,
    classCodes: result.insured.classCodes,
    address: result.insured.address ?? undefined,
    yearsInBusiness: result.insured.yearsInBusiness ?? undefined,
  }
  caseFile.submission.coverage = {
    occurrenceLimit: result.coverage.occurrenceLimit ?? undefined,
    aggregateLimit: result.coverage.aggregateLimit ?? undefined,
    deductible: result.coverage.deductible ?? undefined,
    requestedEffectiveDate: result.coverage.requestedEffectiveDate ?? undefined,
  }
  caseFile.submission.exposures = result.exposures
  caseFile.submission.lossHistory = result.lossHistory
  caseFile.fields = result.fields
  caseFile.status = 'gap_check'

  // Unread-document detection. An authoritative document (ACORD / supplemental /
  // SOV) that was supplied but produced no non-null sourced field means we ran
  // BLIND on it — the data may be in the file, we just couldn't read it. This is
  // distinct from a field genuinely missing, and far more dangerous, so it's
  // surfaced explicitly (it flows to the gap notes, the compliance flag, and the
  // underwriter). Catches both the text-only empty-PDF case and a vision model
  // that returned nothing for a document.
  const AUTHORITATIVE: ReadonlySet<string> = new Set([
    'acord_125',
    'acord_126',
    'gl_supplemental',
    'sov',
  ])
  const sourcedFiles = result.fields
    .filter((f) => f.value !== null && f.source?.file)
    .map((f) => f.source.file.toLowerCase())
  const fileWasSourced = (filename: string) => {
    const f = filename.toLowerCase()
    return sourcedFiles.some((s) => s.includes(f) || f.includes(s))
  }
  const unreadable = Array.from(
    new Set([
      ...emptyTextPdfs,
      ...caseFile.attachments
        .filter((a) => AUTHORITATIVE.has(a.kind) && !fileWasSourced(a.filename))
        .map((a) => a.filename),
    ]),
  )
  if (unreadable.length > 0) {
    caseFile.unreadableDocuments = unreadable
    const hint = nativePdf
      ? 'The vision model returned no usable fields for these.'
      : 'No vision model is configured (LLM_VISION_MODEL) — scanned/compressed PDFs cannot be read as text.'
    await events.activity(
      runId,
      'extraction',
      `⚠ Could not read ${unreadable.length} document(s): ${unreadable.join(', ')}. ${hint} Missing fields below may be present in these files.`,
      0.85,
    )
  }

  // Quality signals.
  const scored = result.fields.filter((f) => f.value !== null)
  const avg =
    scored.length > 0
      ? scored.reduce((s, f) => s + f.confidence, 0) / scored.length
      : 0
  const lowConf = result.fields.filter(
    (f) => f.value !== null && f.confidence < LOW_CONFIDENCE,
  )
  const totalIncurred = result.lossHistory.reduce((s, y) => s + y.incurred, 0)
  const totalClaims = result.lossHistory.reduce((s, y) => s + y.claims, 0)

  await events.activity(
    runId,
    'extraction',
    `Loss run: ${totalClaims} claims, ${formatCurrency(totalIncurred)} incurred`,
    0.9,
  )
  if (lowConf.length > 0) {
    await events.activity(
      runId,
      'extraction',
      `${lowConf.length} field(s) below confidence threshold — flagged for review`,
      0.95,
    )
  }

  await events.output(runId, 'extraction', `${result.fields.length} fields extracted`, {
    insured: caseFile.submission.insured,
    coverage: caseFile.submission.coverage,
    lossHistory: result.lossHistory,
    lowConfidence: lowConf.map((f) => ({ key: f.key, confidence: f.confidence })),
    unreadableDocuments: unreadable,
  })
  await events.completed(
    runId,
    'extraction',
    `${result.fields.length} fields, ${totalClaims} claims`,
    `${Math.round(avg * 100)}% avg conf`,
  )

  return caseFile
}
