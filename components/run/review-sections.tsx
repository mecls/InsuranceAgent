'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, CheckCircle2, Download, AlertTriangle, Send } from 'lucide-react'
import { customerLabel, type CaseFile } from '@/lib/procurement/case-file'
import { euro } from '@/lib/procurement/pricing'
import { approveQuote, rejectQuote } from '@/app/actions/runs'
import { cn } from '@/lib/utils'

/**
 * The user review, rendered as full-width accordion cards: the drafted orçamento
 * (line items + totals + terms), the clarification trail, and the review/approve
 * control (or the sent confirmation).
 */
export function RunReview({
  runId,
  caseFile,
  reviewOpen,
  onAction,
}: {
  runId: string
  caseFile: CaseFile
  reviewOpen: boolean
  onAction?: () => void
}) {
  const cf = caseFile
  const sent = !!cf.sent
  return (
    <div className="space-y-4">
      {cf.lineItems.length > 0 && <QuoteSection cf={cf} />}
      {cf.quote && <TermsSection cf={cf} />}
      {cf.clarifications.length > 0 && <ClarificationsSection cf={cf} />}
      {reviewOpen && !sent && !cf.closedWithoutQuote && (
        <ReviewControl runId={runId} onAction={onAction} />
      )}
      {sent && <SentSection runId={runId} cf={cf} />}
      {cf.closedWithoutQuote && !sent && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[#F9FAFB] px-6 py-4 text-sm text-[var(--color-text-muted)]">
          Orçamento não enviado.
        </div>
      )}
    </div>
  )
}

function Accordion({
  title,
  defaultOpen,
  badge,
  children,
}: {
  title: string
  defaultOpen: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left">
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</span>
          {badge}
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-[var(--color-text-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-[var(--color-border)] px-6 py-5">{children}</div>}
    </div>
  )
}

// ── Orçamento (line items + totals) ──────────────────────────────────────────
function QuoteSection({ cf }: { cf: CaseFile }) {
  const p = cf.pricing
  return (
    <Accordion
      title="Orçamento"
      defaultOpen
      badge={
        p ? (
          <span className="chip" style={{ background: 'var(--color-brand-light)', color: 'var(--color-brand)' }}>
            {euro(p.total)} c/IVA
          </span>
        ) : undefined
      }
    >
      {p?.hasUnpriced && (
        <div className="mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm" style={{ borderColor: '#FCD34D', background: 'var(--color-warning-bg)', color: '#92400E' }}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Há linhas sem preço no catálogo. Reveja antes de enviar.</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-text-muted)]">
              <th className="border-b border-[var(--color-border)] py-2 pr-3 text-left font-medium">Descrição</th>
              <th className="border-b border-[var(--color-border)] px-2 py-2 text-right font-medium">Qtd.</th>
              <th className="border-b border-[var(--color-border)] px-2 py-2 text-left font-medium">Un.</th>
              <th className="border-b border-[var(--color-border)] px-2 py-2 text-right font-medium">Preço</th>
              <th className="border-b border-[var(--color-border)] px-2 py-2 text-right font-medium">IVA</th>
              <th className="border-b border-[var(--color-border)] pl-2 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {cf.lineItems.map((l, i) => (
              <tr key={i} className={cn(l.total == null && 'bg-[var(--color-warning-bg)]')}>
                <td className="border-b border-[#F1F3F6] py-2 pr-3 text-[var(--color-text-secondary)]">{l.description}</td>
                <td className="border-b border-[#F1F3F6] px-2 py-2 text-right tabular">{l.quantity}</td>
                <td className="border-b border-[#F1F3F6] px-2 py-2 text-[var(--color-text-muted)]">{l.unit}</td>
                <td className="border-b border-[#F1F3F6] px-2 py-2 text-right tabular">{euro(l.unitPrice)}</td>
                <td className="border-b border-[#F1F3F6] px-2 py-2 text-right tabular text-[var(--color-text-muted)]">{l.ivaRate != null ? `${l.ivaRate}%` : '—'}</td>
                <td className="border-b border-[#F1F3F6] pl-2 py-2 text-right tabular font-medium text-[var(--color-text-primary)]">{euro(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p && (
        <div className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
          <Row label="Subtotal" value={euro(p.subtotal)} />
          {p.ivaBreakdown.map((b) => (
            <Row key={b.rate} label={`IVA ${b.rate}%`} value={euro(b.amount)} muted />
          ))}
          <div className="border-t border-[var(--color-border)] pt-1.5">
            <Row label="Total" value={euro(p.total)} strong />
          </div>
        </div>
      )}
    </Accordion>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn(muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]', strong && 'font-semibold text-[var(--color-text-primary)]')}>{label}</span>
      <span className={cn('tabular', strong && 'font-semibold text-[var(--color-text-primary)]')}>{value}</span>
    </div>
  )
}

// ── Terms (quote document) ───────────────────────────────────────────────────
function TermsSection({ cf }: { cf: CaseFile }) {
  const q = cf.quote!
  return (
    <Accordion title="Mensagem ao cliente" defaultOpen>
      <div className="text-xs font-semibold text-[var(--color-text-primary)]">{q.subject}</div>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--color-text-secondary)]">{q.body}</pre>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {q.prazoExecucao && <Term label="Prazo de execução" value={q.prazoExecucao} />}
        {q.validade && <Term label="Validade" value={q.validade} />}
        {q.condicoesPagamento && <Term label="Condições de pagamento" value={q.condicoesPagamento} />}
        {q.exclusoes.length > 0 && <Term label="Exclusões" value={q.exclusoes.join('; ')} />}
      </dl>
    </Accordion>
  )
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  )
}

// ── Clarifications trail ─────────────────────────────────────────────────────
function ClarificationsSection({ cf }: { cf: CaseFile }) {
  return (
    <Accordion title="Esclarecimentos com o cliente" defaultOpen={false}>
      <ol className="space-y-3">
        {cf.clarifications.map((c, i) => (
          <li key={i} className="text-sm">
            <div className="text-[var(--color-text-primary)]">P: {c.question}</div>
            <div className="text-[var(--color-text-muted)]">R: {c.answer ?? '(sem resposta)'}</div>
          </li>
        ))}
      </ol>
    </Accordion>
  )
}

// ── Review control ───────────────────────────────────────────────────────────
function ReviewControl({ runId, onAction }: { runId: string; onAction?: () => void }) {
  const [pending, setPending] = useState<null | 'approve' | 'reject'>(null)
  const approve = async () => {
    setPending('approve')
    try {
      await approveQuote(runId)
      onAction?.()
    } catch {
      setPending(null)
    }
  }
  const reject = async () => {
    setPending('reject')
    try {
      await rejectQuote(runId)
      onAction?.()
    } catch {
      setPending(null)
    }
  }
  return (
    <div className="card border-[var(--color-brand)]/30 p-6">
      <div className="text-[15px] font-semibold text-[var(--color-text-primary)]">Rever &amp; enviar</div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">Aprove para enviar o orçamento ao cliente, ou rejeite para não enviar.</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={reject} disabled={pending !== null} className="btn-secondary">
          {pending === 'reject' && <Loader2 className="size-4 animate-spin" />}
          Não enviar
        </button>
        <button onClick={approve} disabled={pending !== null} className="btn-primary">
          {pending === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Aprovar e enviar
        </button>
      </div>
    </div>
  )
}

// ── Sent ─────────────────────────────────────────────────────────────────────
function SentSection({ runId, cf }: { runId: string; cf: CaseFile }) {
  return (
    <Accordion
      title="Enviado ao cliente"
      defaultOpen
      badge={
        <span className="chip inline-flex items-center gap-1" style={{ background: 'var(--color-success-bg)', color: '#065F46' }}>
          <CheckCircle2 className="size-3" /> {cf.sent?.via}
        </span>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Orçamento de <span className="font-semibold text-[var(--color-text-primary)]">{euro(cf.pricing?.total)}</span> enviado a {customerLabel(cf)}.
        </p>
        <a href={`/api/runs/${runId}/quote-pdf`} download className="btn-secondary shrink-0">
          <Download className="size-4" /> Orçamento (PDF)
        </a>
      </div>
    </Accordion>
  )
}
