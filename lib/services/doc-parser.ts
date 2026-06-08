import PostalMime from 'postal-mime'
import * as XLSX from 'xlsx'
import type { AttachmentManifestItem } from '@/lib/underwriting/case-file'

/**
 * DocParser — real ingestion adapters behind a clean interface.
 *  - `.eml`  → headers + body + attachments (postal-mime)
 *  - `.xlsx` → CSV text the LLM can read (SheetJS) — Claude can't ingest xlsx
 *              natively, so loss-run workbooks are flattened to text first
 *  - PDFs    → passed through as base64 and attached natively to Claude (vision);
 *              no separate OCR engine needed
 *
 * Production swaps these for carrier-tuned parsers; the interface stays put.
 */

export type AttachmentKind = AttachmentManifestItem['kind']

export interface ParsedEmail {
  from: { name?: string; address?: string }
  subject: string
  text: string
  attachments: {
    filename: string
    mimeType: string
    bytes: Uint8Array
  }[]
}

/** Classify a submission attachment by filename + mime. Heuristic, deterministic. */
export function classifyAttachment(
  filename: string,
  mime: string,
): AttachmentKind {
  const f = filename.toLowerCase()
  if (/acord.*125|125.*acord|\bgl\b.*app|commercial.*app/.test(f)) return 'acord_125'
  if (/acord.*126|126.*acord|liability.*section/.test(f)) return 'acord_126'
  if (/loss.?run|losses|claims/.test(f) || mime.includes('spreadsheet') || f.endsWith('.xlsx') || f.endsWith('.csv')) {
    return 'loss_run'
  }
  if (/sov|statement.*values|schedule.*values/.test(f)) return 'sov'
  if (/supplement|gl.?supp|questionnaire/.test(f)) return 'gl_supplemental'
  if (/cover|letter|email|message|narrative/.test(f) || mime.startsWith('text/')) {
    return 'cover_letter'
  }
  return 'unknown'
}

export async function parseEml(bytes: ArrayBuffer | Uint8Array): Promise<ParsedEmail> {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const email = await new PostalMime().parse(buffer)
  return {
    from: { name: email.from?.name, address: email.from?.address },
    subject: email.subject ?? '',
    text: email.text ?? '',
    attachments: (email.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      mimeType: a.mimeType ?? 'application/octet-stream',
      bytes:
        a.content instanceof ArrayBuffer
          ? new Uint8Array(a.content)
          : typeof a.content === 'string'
            ? new TextEncoder().encode(a.content)
            : a.content,
    })),
  }
}

/** Flatten an .xlsx workbook to readable CSV text (all sheets). */
export function xlsxToText(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const wb = XLSX.read(data, { type: 'array' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(ws)
    parts.push(`# Sheet: ${name}\n${csv}`)
  }
  return parts.join('\n\n')
}

/** Build an .xlsx workbook from rows (used to generate the synthetic loss run). */
export function rowsToXlsx(sheetName: string, rows: (string | number)[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  // `type: 'array'` returns an ArrayBuffer in this build — wrap so callers get a
  // real Uint8Array (with `.length`) for upload + size reporting.
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Uint8Array(out)
}

/** Decode a UTF-8 text attachment (cover letter, CSV) to a string. */
export function bytesToText(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return new TextDecoder().decode(data)
}

/**
 * Extract visible text from a PDF's content streams. Used on the OpenAI-compatible
 * provider path, where the model has no native PDF vision — so PDFs must be
 * flattened to text first (the Anthropic path attaches them natively instead).
 *
 * Handles uncompressed text-showing operators (`(...) Tj`, `[...] TJ`), which is
 * what the demo's generated ACORD / supplemental PDFs use. Returns '' if no text
 * is recoverable (e.g. a compressed real-world PDF would need a full PDF library).
 */
export function pdfToText(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const raw = new TextDecoder('latin1').decode(data)

  const unescape = (s: string) =>
    s.replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '')

  const lines: string[] = []
  // Each content stream between `stream` and `endstream`.
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let sm: RegExpExecArray | null
  while ((sm = streamRe.exec(raw))) {
    const body = sm[1]
    // `(string) Tj`
    const tjRe = /\(((?:\\.|[^\\()])*)\)\s*Tj/g
    let m: RegExpExecArray | null
    while ((m = tjRe.exec(body))) lines.push(unescape(m[1]))
    // `[(a)(b)] TJ` — concatenate the inner string fragments.
    const tjArrRe = /\[((?:[^\]]|\\\])*)\]\s*TJ/g
    while ((m = tjArrRe.exec(body))) {
      const frags = [...m[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((x) =>
        unescape(x[1]),
      )
      if (frags.length) lines.push(frags.join(''))
    }
  }
  return lines.join('\n').trim()
}

/** Whether the configured LLM provider can ingest PDFs natively (Anthropic only). */
export function providerSupportsNativePdf(): boolean {
  const p = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase()
  return p !== 'openai-compatible' && p !== 'openai'
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk))
  }
  return btoa(binary)
}
