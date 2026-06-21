/**
 * Minimal single-page PDF writer. Produces a genuine (text-bearing) PDF so the
 * synthetic ACORD / supplemental documents exercise the real PDF path in
 * extraction (text flatten, or rasterized to images for the vision model) — no
 * third-party PDF dependency. Helvetica, US Letter, top-down lines.
 *
 * Not a general PDF library: it handles ASCII text lines, which is all the demo
 * forms need. Long lines are wrapped; overflow beyond one page is truncated.
 */

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const FONT_SIZE = 10
const LEADING = 15
const MAX_CHARS = 95 // rough wrap width for Helvetica 10pt within the margins
const MAX_LINES = Math.floor((PAGE_H - 2 * MARGIN) / LEADING)

function escapePdfText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrap(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line]
  const words = line.split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > MAX_CHARS) {
      if (cur) out.push(cur)
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) out.push(cur)
  return out
}

export function makeTextPdf(title: string, lines: string[]): Uint8Array {
  const allLines = [title, '', ...lines].flatMap(wrap).slice(0, MAX_LINES)

  // Build the content stream (text positioned from the top-left).
  const startY = PAGE_H - MARGIN
  let content = `BT\n/F1 ${FONT_SIZE} Tf\n${MARGIN} ${startY} Td\n${LEADING} TL\n`
  allLines.forEach((ln, i) => {
    content += `(${escapePdfText(ln)}) Tj\n`
    if (i < allLines.length - 1) content += `T*\n`
  })
  content += `ET`

  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = `%PDF-1.4\n`
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += `0000000000 65535 f \n`
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return new TextEncoder().encode(pdf)
}
