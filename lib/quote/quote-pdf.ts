import type { RunRow } from '@/lib/db/runs'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { SITE_CONFIG } from '@/lib/site-config'
import { formatCurrency } from '@/lib/format'

/**
 * Quote PDF — the finished, downloadable quotation. Built with a small
 * dependency-free PDF composer that supports color, badge "pills", panels and
 * table hairlines, so the export keeps the same visual cues as the on-screen
 * review (SIMULATED / INSUFFICIENT DATA tags, REFER/FLAG badges, rose warning
 * text, green bound notice). Deterministic: it just renders the Case File, and
 * carries every reliability / unread-document caveat through to print.
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

// ── Quote document content ───────────────────────────────────────────────────
const TODAY = () =>
  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const heading = (text: string): El => ({ t: 'text', text, size: 12, bold: true, color: C.ink, gapBefore: 16 })
const kv = (label: string, value: string, topBorder = false): El => ({ t: 'kv', label, value, size: 10, topBorder })

export function quoteRef(slug: string): string {
  return `GL-Q-${slug.toUpperCase()}`
}
export function quoteFilename(caseFile: CaseFile | null, slug: string): string {
  const name = caseFile?.submission.insured?.name ?? 'submission'
  const safe = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `quote-${safe || 'submission'}-${slug}.pdf`
}

const decisionColors = (d: 'in' | 'out' | 'refer'): { bg: Color; fg: Color; label: string } =>
  d === 'in'
    ? { bg: C.greenBg, fg: C.greenFg, label: 'IN APPETITE' }
    : d === 'out'
      ? { bg: C.roseBg, fg: C.roseFg, label: 'OUT OF APPETITE' }
      : { bg: C.amberBg, fg: C.amberFg, label: 'REFER' }

/** Build the quote (or decline notice) PDF for a finished run. */
export function buildQuotePdf(run: RunRow): Uint8Array {
  const cf = run.case_file
  const els: El[] = []

  // Header.
  els.push({ t: 'text', text: `${SITE_CONFIG.brand} — Indicative Quotation`, size: 18, bold: true, color: C.ink })
  els.push({ t: 'text', text: SITE_CONFIG.lineOfBusinessLabel, size: 10, color: C.n500, gapBefore: 2 })
  els.push(kv('Quote ref', quoteRef(run.slug)))
  els.push(kv('Date', TODAY()))

  if (!cf) {
    els.push({ t: 'text', text: 'Case file not available.', size: 10, color: C.n700, gapBefore: 16 })
    return render(els)
  }

  if (run.bound_policy) {
    els.push({
      t: 'panel',
      bg: C.greenBg,
      gapBefore: 12,
      lines: [{ text: `Bound — policy ${run.bound_policy.policyNumber} (demo record)`, size: 10, color: C.greenFg, bold: true }],
    })
  }

  const insured = cf.submission.insured
  const coverage = cf.submission.coverage

  els.push(heading('Named insured'))
  els.push(kv('Insured', insured?.name ?? 'Not stated'))
  if (insured?.address) els.push(kv('Address', insured.address))
  if (insured?.fein) els.push(kv('FEIN', insured.fein))
  if (insured?.naics) els.push(kv('NAICS', insured.naics))
  if (insured?.yearsInBusiness != null) els.push(kv('Years in business', String(insured.yearsInBusiness)))

  els.push(heading('Coverage requested'))
  els.push(kv('Per-occurrence limit', coverage?.occurrenceLimit != null ? formatCurrency(coverage.occurrenceLimit) : 'Not stated'))
  els.push(kv('General aggregate limit', coverage?.aggregateLimit != null ? formatCurrency(coverage.aggregateLimit) : 'Not stated'))
  if (coverage?.deductible != null) els.push(kv('Deductible', formatCurrency(coverage.deductible)))
  if (coverage?.requestedEffectiveDate) els.push(kv('Requested effective date', coverage.requestedEffectiveDate))

  if (cf.unreadableDocuments && cf.unreadableDocuments.length > 0) {
    els.push(heading('Data quality warning'))
    els.push({
      t: 'panel',
      bg: C.roseBgSoft,
      lines: [
        {
          text: `${cf.unreadableDocuments.length} submission document(s) could not be read: ${cf.unreadableDocuments.join(', ')}. Fields shown as "Not stated" may be present in these files. Re-process with a vision model before relying on this quotation.`,
          size: 10,
          color: C.roseFg,
        },
      ],
    })
  }

  // Declined path.
  if (cf.declined || !cf.quote) {
    els.push(heading('Disposition'))
    els.push({
      t: 'row',
      segs: [{ kind: 'badge', text: cf.declined ? 'DECLINED' : 'NO QUOTE', size: 10, bg: C.roseBg, color: C.roseFg }],
    })
    if (cf.appetite) {
      els.push({ t: 'text', text: `Score ${cf.appetite.score.toFixed(2)}`, size: 10, color: C.n500, gapBefore: 6 })
      for (const r of cf.appetite.reasons) els.push({ t: 'bullet', text: r, size: 10, color: C.n700, dot: C.n400 })
    }
    pushDisclosures(els, cf)
    return render(els)
  }

  // Premium with tags.
  els.push(heading('Indicative quote'))
  const premiumRow: Seg[] = [
    { kind: 'text', text: formatCurrency(cf.quote.premium, cf.quote.currency), size: 22, bold: true, color: C.ink },
    { kind: 'badge', text: 'SIMULATED RATING', size: 9, bg: C.amberBg, color: C.amberFg },
  ]
  if (cf.quote.reliable === false) {
    premiumRow.push({ kind: 'badge', text: 'INSUFFICIENT DATA - PLACEHOLDER', size: 9, bg: C.roseBg, color: C.roseFg })
  }
  els.push({ t: 'row', segs: premiumRow, gapBefore: 4 })

  if (cf.quote.reliable === false && cf.quote.assumptions?.length) {
    els.push({
      t: 'panel',
      bg: C.roseBgSoft,
      gapBefore: 6,
      lines: cf.quote.assumptions.map((a) => ({ text: a, size: 9.5, color: C.roseFg, dot: C.roseFg })),
    })
  }
  if (cf.quote.summary) els.push({ t: 'text', text: cf.quote.summary, size: 10, color: C.n700, gapBefore: 8 })

  els.push(heading('Rating breakdown'))
  cf.quote.ratingBreakdown.forEach((b, i) =>
    els.push(kv(b.label, b.kind === 'modifier' ? `x${b.value}` : formatCurrency(b.value), i > 0)),
  )

  if (cf.appetite) {
    const dc = decisionColors(cf.appetite.decision)
    els.push(heading('Appetite & risk'))
    els.push({
      t: 'row',
      segs: [
        { kind: 'badge', text: dc.label, size: 9, bg: dc.bg, color: dc.fg },
        { kind: 'text', text: `score ${cf.appetite.score.toFixed(2)}`, size: 10, color: C.n500 },
      ],
    })
    for (const r of cf.appetite.reasons) els.push({ t: 'bullet', text: r, size: 10, color: C.n700, dot: C.n400 })
  }

  if (cf.quote.preBindChecklist.length > 0) {
    els.push(heading('Pre-bind checklist'))
    for (const c of cf.quote.preBindChecklist) els.push({ t: 'check', text: c.item, size: 10, color: C.n700 })
  }

  pushDisclosures(els, cf)
  return render(els)
}

function pushDisclosures(els: El[], cf: CaseFile): void {
  if (cf.audit) {
    const flag = cf.audit.compliance === 'pass'
    const bg = flag ? C.greenBg : C.amberBg
    const fg = flag ? C.greenFg : C.amberFg
    els.push(heading('Compliance & audit'))
    els.push({ t: 'row', segs: [{ kind: 'badge', text: cf.audit.compliance.toUpperCase(), size: 9, bg, color: fg }] })
    if (cf.audit.summary) els.push({ t: 'text', text: cf.audit.summary, size: 10, color: C.n700, gapBefore: 4 })
    for (const f of cf.audit.flags) els.push({ t: 'bullet', text: f, size: 10, color: C.roseFg, dot: C.roseFg })
  }
  els.push(heading('Important notice'))
  els.push({
    t: 'text',
    text: 'This quotation was produced by an automated underwriting assistant for demonstration. The premium is generated by a SIMULATED rating engine and is non-binding. No coverage is in force unless and until a policy is issued by the carrier. Figures are subject to underwriting review and verification of the submission.',
    size: 9,
    color: C.n500,
  })
}
