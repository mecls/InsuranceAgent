import type { RunRow } from '@/lib/db/runs'
import { customerLabel, type CaseFile } from '@/lib/procurement/case-file'
import { euro } from '@/lib/procurement/pricing'
import { SITE_CONFIG } from '@/lib/site-config'

/**
 * Orçamento PDF — the customer-facing quote (line items, totals, terms). Built
 * with a small dependency-free PDF composer. Deterministic: it just renders the
 * Case File.
 */

// ── Colors (Tailwind-matched, 0..1 rgb) ─────────────────────────────────────
type Color = [number, number, number]
const rgb = (r: number, g: number, b: number): Color => [r / 255, g / 255, b / 255]
const C = {
  ink: rgb(23, 23, 23),
  n700: rgb(64, 64, 64),
  n500: rgb(115, 115, 115),
  n400: rgb(163, 163, 163),
  hair: rgb(229, 229, 229),
  amberBg: rgb(254, 243, 199),
  amberFg: rgb(180, 83, 9),
  roseBg: rgb(255, 228, 230),
  roseBgSoft: rgb(255, 241, 242),
  roseBorder: rgb(254, 205, 211),
  roseFg: rgb(190, 18, 60),
  greenBg: rgb(220, 252, 231),
  greenFg: rgb(21, 128, 61),
} as const

// ── Page geometry ────────────────────────────────────────────────────────────
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const USABLE_W = PAGE_W - 2 * MARGIN
const BOTTOM = MARGIN

function ascii(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
}
function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
function col(c: Color): string {
  return `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`
}
function charW(size: number, bold: boolean): number {
  return size * (bold ? 0.55 : 0.5)
}
function textWidth(s: string, size: number, bold: boolean): number {
  return ascii(s).length * charW(size, bold)
}
function wrap(text: string, size: number, bold: boolean, width: number): string[] {
  const maxChars = Math.max(6, Math.floor(width / charW(size, bold)))
  const out: string[] = []
  for (const raw of ascii(text).split('\n')) {
    if (raw.length <= maxChars) {
      out.push(raw)
      continue
    }
    let cur = ''
    for (const w of raw.split(' ')) {
      if ((cur + ' ' + w).trim().length > maxChars) {
        if (cur) out.push(cur)
        cur = w
      } else {
        cur = (cur + ' ' + w).trim()
      }
    }
    if (cur) out.push(cur)
  }
  return out.length ? out : ['']
}

// ── Document model ───────────────────────────────────────────────────────────
type Seg =
  | { kind: 'text'; text: string; size: number; bold?: boolean; color: Color }
  | { kind: 'badge'; text: string; size: number; bg: Color; color: Color }
interface PanelLine {
  text: string
  size: number
  color: Color
  bold?: boolean
  dot?: Color
}
type El =
  | { t: 'space'; h: number }
  | { t: 'text'; text: string; size: number; bold?: boolean; color: Color; gapBefore?: number; indent?: number }
  | { t: 'bullet'; text: string; size: number; color: Color; dot: Color }
  | { t: 'check'; text: string; size: number; color: Color }
  | { t: 'row'; segs: Seg[]; gapBefore?: number }
  | { t: 'kv'; label: string; value: string; size: number; topBorder?: boolean }
  | { t: 'panel'; bg: Color; border?: Color; lines: PanelLine[]; gapBefore?: number }

const LH = 1.35 // line-height factor
const ASC = 0.74 // ascent factor (baseline below top)

// ── Renderer ─────────────────────────────────────────────────────────────────
function render(els: El[]): Uint8Array {
  const pages: string[][] = [[]]
  let y = PAGE_H - MARGIN
  const ops = () => pages[pages.length - 1]
  const newPage = () => {
    pages.push([])
    y = PAGE_H - MARGIN
  }
  const fitOrBreak = (h: number) => {
    if (y - h < BOTTOM && ops().length > 0) newPage()
  }

  const text = (x: number, baseline: number, s: string, size: number, bold: boolean, color: Color) => {
    ops().push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(color)} rg 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${escapePdf(s)}) Tj ET`,
    )
  }
  const roundRect = (x: number, yb: number, w: number, h: number, r: number, fill: Color) => {
    const k = 0.5523 * r
    ops().push(
      `${col(fill)} rg`,
      `${(x + r).toFixed(2)} ${yb.toFixed(2)} m`,
      `${(x + w - r).toFixed(2)} ${yb.toFixed(2)} l`,
      `${(x + w - r + k).toFixed(2)} ${yb.toFixed(2)} ${(x + w).toFixed(2)} ${(yb + r - k).toFixed(2)} ${(x + w).toFixed(2)} ${(yb + r).toFixed(2)} c`,
      `${(x + w).toFixed(2)} ${(yb + h - r).toFixed(2)} l`,
      `${(x + w).toFixed(2)} ${(yb + h - r + k).toFixed(2)} ${(x + w - r + k).toFixed(2)} ${(yb + h).toFixed(2)} ${(x + w - r).toFixed(2)} ${(yb + h).toFixed(2)} c`,
      `${(x + r).toFixed(2)} ${(yb + h).toFixed(2)} l`,
      `${(x + r - k).toFixed(2)} ${(yb + h).toFixed(2)} ${x.toFixed(2)} ${(yb + h - r + k).toFixed(2)} ${x.toFixed(2)} ${(yb + h - r).toFixed(2)} c`,
      `${x.toFixed(2)} ${(yb + r).toFixed(2)} l`,
      `${x.toFixed(2)} ${(yb + r - k).toFixed(2)} ${(x + r - k).toFixed(2)} ${yb.toFixed(2)} ${(x + r).toFixed(2)} ${yb.toFixed(2)} c`,
      `f`,
    )
  }
  const hline = (yy: number) => {
    ops().push(`${col(C.hair)} RG 0.6 w ${MARGIN} ${yy.toFixed(2)} m ${(PAGE_W - MARGIN)} ${yy.toFixed(2)} l S`)
  }
  const square = (x: number, yb: number, s: number, color: Color) => {
    ops().push(`${col(color)} RG 0.8 w ${x.toFixed(2)} ${yb.toFixed(2)} ${s} ${s} re S`)
  }
  const dot = (x: number, yb: number, r: number, color: Color) => {
    roundRect(x, yb, r * 2, r * 2, r, color)
  }

  for (const el of els) {
    if (el.t === 'space') {
      y -= el.h
      continue
    }
    if ('gapBefore' in el && el.gapBefore && ops().length > 0) y -= el.gapBefore

    if (el.t === 'text') {
      const indent = el.indent ?? 0
      const lines = wrap(el.text, el.size, el.bold ?? false, USABLE_W - indent)
      const h = lines.length * el.size * LH
      fitOrBreak(h)
      lines.forEach((ln, i) => text(MARGIN + indent, y - el.size * ASC - i * el.size * LH, ln, el.size, el.bold ?? false, el.color))
      y -= h
    } else if (el.t === 'bullet') {
      const indent = 16
      const lines = wrap(el.text, el.size, false, USABLE_W - indent)
      const h = lines.length * el.size * LH
      fitOrBreak(h)
      dot(MARGIN + 4, y - el.size * 0.62, 1.7, el.dot)
      lines.forEach((ln, i) => text(MARGIN + indent, y - el.size * ASC - i * el.size * LH, ln, el.size, false, el.color))
      y -= h
    } else if (el.t === 'check') {
      const indent = 18
      const lines = wrap(el.text, el.size, false, USABLE_W - indent)
      const h = lines.length * el.size * LH
      fitOrBreak(h)
      square(MARGIN + 2, y - el.size * 0.82, el.size * 0.7, C.n400)
      lines.forEach((ln, i) => text(MARGIN + indent, y - el.size * ASC - i * el.size * LH, ln, el.size, false, el.color))
      y -= h
    } else if (el.t === 'row') {
      const heights = el.segs.map((s) => (s.kind === 'badge' ? s.size + 8 : s.size))
      const rowH = Math.max(...heights)
      fitOrBreak(rowH)
      let x = MARGIN
      el.segs.forEach((s, i) => {
        const segH = heights[i]
        const segTop = y - (rowH - segH) / 2
        if (s.kind === 'badge') {
          const w = textWidth(s.text, s.size, true) + 12
          const yb = segTop - segH
          roundRect(x, yb, w, segH, segH / 2, s.bg)
          text(x + 6, yb + 4 + s.size * 0.15, ascii(s.text), s.size, true, s.color)
          x += w + 8
        } else {
          text(x, segTop - s.size * ASC, ascii(s.text), s.size, s.bold ?? false, s.color)
          x += textWidth(s.text, s.size, s.bold ?? false) + 8
        }
      })
      y -= rowH
    } else if (el.t === 'kv') {
      const h = el.size * 1.9
      fitOrBreak(h)
      if (el.topBorder) hline(y)
      const baseline = y - el.size * ASC - el.size * 0.4
      text(MARGIN, baseline, ascii(el.label), el.size, false, C.n700)
      const vw = textWidth(el.value, el.size, false)
      text(PAGE_W - MARGIN - vw, baseline, ascii(el.value), el.size, false, C.ink)
      y -= h
    } else if (el.t === 'panel') {
      const padX = 10
      const padY = 8
      const innerW = USABLE_W - 2 * padX
      const wrapped = el.lines.map((l) => ({ l, subs: wrap(l.text, l.size, l.bold ?? false, innerW - (l.dot ? 14 : 0)) }))
      const innerH = wrapped.reduce((s, w) => s + w.subs.length * w.l.size * LH, 0)
      const h = innerH + 2 * padY
      fitOrBreak(h)
      const yb = y - h
      roundRect(MARGIN, yb, USABLE_W, h, 6, el.bg)
      let ty = y - padY
      for (const { l, subs } of wrapped) {
        const tx = MARGIN + padX + (l.dot ? 14 : 0)
        if (l.dot) dot(MARGIN + padX + 2, ty - l.size * 0.62, 1.7, l.dot)
        subs.forEach((ln, i) => text(tx, ty - l.size * ASC - i * l.size * LH, ln, l.size, l.bold ?? false, l.color))
        ty -= subs.length * l.size * LH
      }
      y -= h
    }
  }

  // Serialize. Objects: 1 Catalog, 2 Pages, 3 Helvetica, 4 Helvetica-Bold,
  // then per page p: page obj (5+2p) and content obj (6+2p).
  const pageObjId = (p: number) => 5 + 2 * p
  const contentObjId = (p: number) => 6 + 2 * p
  const kids = pages.map((_, p) => `${pageObjId(p)} 0 R`).join(' ')
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`,
  ]
  pages.forEach((pageOps, p) => {
    const content = pageOps.join('\n')
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId(p)} 0 R >>`,
    )
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  })

  let pdf = `%PDF-1.4\n`
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}


// ── Document content ─────────────────────────────────────────────────────────
const TODAY = () =>
  new Date().toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' })

const heading = (text: string): El => ({ t: 'text', text, size: 12, bold: true, color: C.ink, gapBefore: 16 })
const kv = (label: string, value: string, topBorder = false): El => ({ t: 'kv', label, value, size: 10, topBorder })

export function quoteRef(slug: string): string {
  return `ORC-${slug.toUpperCase()}`
}

export function quoteFilename(caseFile: CaseFile | null, slug: string): string {
  const name = caseFile?.request?.summary ?? 'orcamento'
  const safe = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `orcamento-${safe || 'cliente'}-${slug}.pdf`
}

/** Build the customer-facing orçamento PDF for a run. */
export function buildQuotePdf(run: RunRow): Uint8Array {
  const cf = run.case_file
  const els: El[] = []

  els.push({ t: 'text', text: SITE_CONFIG.brand, size: 18, bold: true, color: C.ink })
  els.push({ t: 'text', text: 'Orçamento', size: 11, color: C.n500, gapBefore: 2 })

  if (!cf) {
    els.push({ t: 'text', text: 'Caso não disponível.', size: 10, color: C.n700, gapBefore: 16 })
    return render(els)
  }

  els.push(kv('Referência', quoteRef(run.slug)))
  els.push(kv('Data', TODAY()))
  els.push(kv('Cliente', customerLabel(cf)))
  els.push(kv('Pedido', cf.request.summary))

  els.push(heading('Descrição dos trabalhos'))
  for (const l of cf.lineItems) {
    els.push(kv(`${l.description} (${l.quantity} ${l.unit} x ${euro(l.unitPrice)})`, euro(l.total), true))
  }

  const p = cf.pricing
  if (p) {
    els.push(heading('Totais'))
    els.push(kv('Subtotal', euro(p.subtotal)))
    for (const b of p.ivaBreakdown) els.push(kv(`IVA ${b.rate}%`, euro(b.amount)))
    els.push(kv('Total (c/IVA)', euro(p.total), true))
  }

  const q = cf.quote
  if (q) {
    els.push(heading('Condições'))
    if (q.prazoExecucao) els.push(kv('Prazo de execução', q.prazoExecucao))
    if (q.validade) els.push(kv('Validade do orçamento', q.validade))
    if (q.condicoesPagamento) els.push(kv('Condições de pagamento', q.condicoesPagamento))
    if (q.exclusoes.length > 0) {
      els.push({ t: 'text', text: 'Exclusões:', size: 10, bold: true, color: C.n700, gapBefore: 8 })
      for (const e of q.exclusoes) els.push({ t: 'bullet', text: e, size: 10, color: C.n700, dot: C.n400 })
    }
    if (q.body) {
      els.push(heading('Mensagem'))
      els.push({ t: 'text', text: q.body, size: 10, color: C.n700, gapBefore: 4 })
    }
  }

  els.push(heading('Nota'))
  els.push({
    t: 'text',
    text: 'Orçamento gerado com o assistente Miraside. Os preços resultam do catálogo da empresa e são válidos pelo período indicado.',
    size: 9,
    color: C.n500,
  })

  return render(els)
}
