import PostalMime from 'postal-mime'
import * as XLSX from 'xlsx'

/**
 * DocParser — real ingestion adapters behind a clean interface.
 *  - `.eml`  → headers + body + attachments (postal-mime), used to ingest
 *              fornecedor replies that arrive as forwarded emails
 *  - `.xlsx` → CSV text the LLM can read (SheetJS)
 *  - PDFs    → rasterized to page images for an open vision model (pdfToImages),
 *              or flattened to text (pdfToText) when no vision model is set
 *
 * Production swaps these for tuned parsers; the interface stays put.
 */

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
 * Extract visible text from a PDF's content streams. Used in text-only mode (no
 * LLM_VISION_MODEL configured), where PDFs must be flattened to text before the
 * model sees them. When a vision model is set, PDFs go through pdfToImages instead.
 *
 * Handles uncompressed text-showing operators (`(...) Tj`, `[...] TJ`), which is
 * what the demo's generated ACORD / supplemental PDFs use. Returns '' if no text
 * is recoverable (e.g. a compressed/scanned real-world PDF — use the vision path).
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

/**
 * Whether a vision model is configured (LLM_VISION_MODEL). When set, the
 * extraction agent sends PDFs to the model as page images (via pdfToImages)
 * instead of flattening them to text. Point LLM_VISION_MODEL at an open VLM on
 * your OpenAI-compatible endpoint, e.g. `qwen2.5vl:7b` on Ollama. Leave it unset
 * to stay text-only (DeepSeek), in which case PDFs are flattened with pdfToText.
 */
export function pdfVisionEnabled(): boolean {
  return Boolean(process.env.LLM_VISION_MODEL?.trim())
}

/**
 * Rasterize a PDF to base64 PNG page images (one per page, capped). This is how
 * open-source vision models read PDFs: they take images, not PDF files, so each
 * page is rendered and sent as an image. Works on scanned/image-only PDFs too,
 * since it rasterizes the rendered page rather than scraping text operators.
 *
 * `pdf-to-img` (pdfjs-dist under the hood) is loaded dynamically so it only
 * pulls in on the server paths that actually rasterize.
 */
export async function pdfToImages(
  bytes: ArrayBuffer | Uint8Array,
  opts?: { scale?: number; maxPages?: number },
): Promise<string[]> {
  const { pdf } = await import('pdf-to-img')
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const doc = await pdf(data, { scale: opts?.scale ?? 2 })
  const max = opts?.maxPages ?? Number.POSITIVE_INFINITY
  const out: string[] = []
  for await (const page of doc) {
    if (out.length >= max) break
    out.push(Buffer.from(page).toString('base64'))
  }
  return out
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
