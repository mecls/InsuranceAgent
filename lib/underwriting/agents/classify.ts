import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import {
  AttachmentClassificationSchema,
  CLASSIFY_TOOL_INPUT_SCHEMA,
} from '@/lib/underwriting/schema'
import {
  classifyAttachment as classifyHeuristic,
  type AttachmentKind,
} from '@/lib/services/doc-parser'

/** A file presented to the classifier: name, mime, and a short text preview. */
export interface ClassifyInput {
  filename: string
  mime: string
  /** Best-effort text preview (PDF text, flattened sheet, or raw text). */
  preview: string
}

const CLASSIFY_SYSTEM = `# This call: ATTACHMENT CLASSIFICATION

A broker has emailed a General Liability submission. Label each attached file with its document kind so the extraction agent knows how to read it.

## Kinds
- acord_125: the ACORD commercial insurance application (named insured, address, requested limits).
- acord_126: the ACORD GL section / commercial general liability supplement.
- gl_supplemental: a GL supplemental application or operations questionnaire.
- loss_run: prior loss / claims history (often a spreadsheet: policy year, claim count, incurred).
- sov: statement of values / schedule of locations.
- cover_letter: the broker's cover email or a narrative letter.
- unknown: none of the above, or not enough signal to tell.

## Rules
- Return exactly one entry per input file, echoing the filename verbatim.
- Judge by the filename AND the preview text. A spreadsheet of years and claim amounts is a loss_run even if the name is generic.
- If the preview is empty (e.g. an image-only PDF), classify from the filename alone; use unknown only when truly unclear.`

const PREVIEW_CAP = 1200

/**
 * Classify a batch of uploaded submission files into document kinds, using the
 * LLM (filename + text preview). Provider-agnostic: previews are passed as text,
 * so it works on the OpenAI-compatible path too (no native PDF needed). Any file
 * the model omits falls back to the deterministic filename/mime heuristic, so the
 * result always covers every input.
 */
export async function classifyAttachments(
  files: ClassifyInput[],
): Promise<Record<string, AttachmentKind>> {
  const fallback = (): Record<string, AttachmentKind> => {
    const out: Record<string, AttachmentKind> = {}
    for (const f of files) out[f.filename] = classifyHeuristic(f.filename, f.mime)
    return out
  }

  if (files.length === 0) return {}

  const userPrompt = `Files to classify:

${files
  .map((f, i) => {
    const preview = f.preview.trim().slice(0, PREVIEW_CAP)
    return `### File ${i + 1}: ${f.filename} (${f.mime})
${preview ? preview : '[no extractable text preview]'}`
  })
  .join('\n\n')}

# Your task
Call \`classify_attachments\` exactly once with one entry per file above.`

  let result
  try {
    result = await runTool({
      systemBlocks: [sharedSystemBlock(), { type: 'text', text: CLASSIFY_SYSTEM }],
      userPrompt,
      toolName: 'classify_attachments',
      toolDescription:
        'Label each submission file with its document kind. One entry per input file, echoing the filename.',
      toolInputSchema: CLASSIFY_TOOL_INPUT_SCHEMA,
      schema: AttachmentClassificationSchema,
      callLabel: 'classify',
    })
  } catch {
    // The classifier is non-critical: never block a run on it. Fall back to the
    // deterministic heuristic for the whole batch.
    return fallback()
  }

  // Start from the heuristic so any file the model skipped still gets a kind,
  // then overlay the model's labels (matched case-insensitively on filename).
  const out = fallback()
  const byName = new Map(files.map((f) => [f.filename.toLowerCase(), f.filename]))
  for (const c of result.classifications) {
    const match = byName.get(c.filename.toLowerCase())
    if (match) out[match] = c.kind
  }
  return out
}
