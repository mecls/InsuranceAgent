'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, CheckCircle2, Download } from 'lucide-react'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { bindQuote } from '@/app/actions/runs'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface BoundPolicy {
  policyNumber: string
  boundAt: string
}

/** The underwriter review, rendered as full-width accordion cards. */
export function RunReview({
  runId,
  caseFile,
  boundPolicy,
  onBound,
}: {
  runId: string
  caseFile: CaseFile
  boundPolicy: BoundPolicy | null
  onBound?: () => void
}) {
  const cf = caseFile
  return (
    <div className="space-y-4">
      {(cf.quote || cf.declined) && (
        <QuoteSection runId={runId} cf={cf} bound={boundPolicy != null} onBound={onBound} />
      )}
      {cf.appetite && <AppetiteSection cf={cf} />}
      {cf.enrichment && <DossierSection cf={cf} />}
      {cf.audit && <ComplianceSection cf={cf} />}
      {cf.quote?.preBindChecklist?.length ? <PreBindSection cf={cf} /> : null}
      {boundPolicy && <PolicyRecord runId={runId} policy={boundPolicy} />}
    </div>
  )
}

// ── Accordion shell ──────────────────────────────────────────────────────────
function Accordion({
  title,
  defaultOpen,
  badge,
  id,
  children,
}: {
  title: string
  defaultOpen: boolean
  badge?: React.ReactNode
  id?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div id={id} className="card overflow-hidden scroll-mt-20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</span>
          {badge}
        </div>
        <ChevronDown
          className={cn('size-4 shrink-0 text-[var(--color-text-muted)] transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="border-t border-[var(--color-border)] px-6 py-5">{children}</div>}
    </div>
  )
}

// ── Indicative quote ─────────────────────────────────────────────────────────
function QuoteSection({
  runId,
  cf,
  bound,
  onBound,
}: {
  runId: string
  cf: CaseFile
  bound: boolean
  onBound?: () => void
}) {
  const [premium, setPremium] = useState(cf.quote?.premium != null ? String(cf.quote.premium) : '')
  const [binding, setBinding] = useState(false)
  const [policy, setPolicy] = useState<string | null>(null)

  const onBind = async () => {
    setBinding(true)
    try {
      const override = Number(premium)
      const res = await bindQuote(
        runId,
        Number.isFinite(override) && override !== cf.quote?.premium ? override : undefined,
      )
      setPolicy(res.policyNumber)
      onBound?.()
    } finally {
      setBinding(false)
    }
  }

  return (
    <Accordion title="Indicative Quote" defaultOpen id="indicative-quote">
      {cf.declined ? (
        <p className="text-sm text-[var(--color-danger)]">
          Declined — out of appetite. No quote produced.
        </p>
      ) : cf.quote ? (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-3xl font-semibold tabular text-[var(--color-text-primary)]">
              {formatCurrency(cf.quote.premium, cf.quote.currency)}
            </span>
            <span className="chip" style={{ background: 'var(--color-warning-bg)', color: '#92400E' }}>
              SIMULATED RATING
            </span>
            {cf.quote.reliable === false && (
              <span className="chip" style={{ background: 'var(--color-danger-bg)', color: '#991B1B' }}>
                INSUFFICIENT DATA
              </span>
            )}
          </div>

          {cf.quote.reliable === false && cf.quote.assumptions?.length ? (
            <Callout tone="amber" className="mt-4">
              <ul className="space-y-1">
                {cf.quote.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Callout>
          ) : null}

          {cf.quote.summary && (
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {cf.quote.summary}
            </p>
          )}

          {/* Breakdown table */}
          <div className="mt-4 overflow-hidden rounded-md border border-[var(--color-border)]">
            {cf.quote.ratingBreakdown.map((b, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-between px-3 py-2 text-sm',
                  i % 2 === 1 && 'bg-[#F9FAFB]',
                )}
              >
                <span className="text-[var(--color-text-secondary)]">{b.label}</span>
                <span className="tabular text-[var(--color-text-primary)]">
                  {b.kind === 'modifier' ? `×${b.value}` : formatCurrency(b.value)}
                </span>
              </div>
            ))}
          </div>

          {/* Bind control */}
          {!bound && !policy ? (
            <div className="mt-5 flex items-center gap-3 border-t border-[var(--color-border)] pt-4">
              <label className="text-xs text-[var(--color-text-muted)]">
                Bound premium
                <input
                  value={premium}
                  onChange={(e) => setPremium(e.target.value)}
                  inputMode="numeric"
                  className="input ml-2 inline-block h-9 w-32 align-middle"
                />
              </label>
              <button onClick={onBind} disabled={binding} className="btn-primary ml-auto">
                {binding && <Loader2 className="size-4 animate-spin" />}
                Bind quote
              </button>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2 rounded-md bg-[var(--color-success-bg)] px-3 py-2.5 text-sm text-[#065F46]">
              <CheckCircle2 className="size-4" />
              Bound — policy{' '}
              <span className="font-mono font-semibold">{policy ?? 'issued'}</span> (demo record)
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-placeholder)]">No quote.</p>
      )}
    </Accordion>
  )
}

// ── Appetite & risk ──────────────────────────────────────────────────────────
function AppetiteSection({ cf }: { cf: CaseFile }) {
  const a = cf.appetite!
  const badge = decisionBadge(a.decision)
  return (
    <Accordion
      title="Appetite & Risk Decision"
      defaultOpen
      badge={
        <span className="flex items-center gap-2">
          <span className="chip" style={{ background: badge.bg, color: badge.fg }}>
            {badge.label}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">score {a.score.toFixed(2)}</span>
        </span>
      }
    >
      {a.rules?.length > 0 && (
        <ul className="space-y-2.5">
          {a.rules.map((r, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <RulePrefix outcome={r.outcome} />
              <span className="text-[var(--color-text-secondary)]">
                <span className="font-medium text-[var(--color-text-primary)]">{r.ruleId}</span>{' '}
                {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.reasons.length > 0 && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-[var(--color-text-secondary)]">
            {a.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </Accordion>
  )
}

// ── Research dossier ─────────────────────────────────────────────────────────
function DossierSection({ cf }: { cf: CaseFile }) {
  const e = cf.enrichment!
  return (
    <Accordion title="Research Dossier" defaultOpen={false}>
      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {e.dossier}
      </p>
      {e.citations.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {e.citations.map((c, i) => (
            <li key={i}>
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-brand)] hover:underline"
              >
                [{i + 1}] {c.title ?? c.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Accordion>
  )
}

// ── Compliance & audit ───────────────────────────────────────────────────────
function ComplianceSection({ cf }: { cf: CaseFile }) {
  const a = cf.audit!
  const pass = a.compliance === 'pass'
  return (
    <Accordion
      title="Compliance & Audit"
      defaultOpen={!pass}
      badge={
        <span
          className="chip"
          style={{
            background: pass ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
            color: pass ? '#065F46' : '#92400E',
          }}
        >
          {a.compliance.toUpperCase()}
        </span>
      }
    >
      <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{a.summary}</p>
      {a.flags.length > 0 && (
        <ol className="mt-3 space-y-2">
          {a.flags.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-danger)]" />
              {f}
            </li>
          ))}
        </ol>
      )}
    </Accordion>
  )
}

// ── Pre-bind checklist ───────────────────────────────────────────────────────
function PreBindSection({ cf }: { cf: CaseFile }) {
  const items = cf.quote!.preBindChecklist
  const [checked, setChecked] = useState<boolean[]>(() => items.map((c) => c.done))
  return (
    <Accordion title="Pre-Bind Checklist" defaultOpen>
      <ul className="space-y-2.5">
        {items.map((c, i) => (
          <li key={i}>
            <button
              onClick={() => setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
              className="flex w-full items-start gap-2.5 text-left text-sm"
            >
              <span
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded border',
                  checked[i]
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                    : 'border-[var(--color-border-input)] bg-white',
                )}
              >
                {checked[i] && <CheckCircle2 className="size-3" strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  checked[i]
                    ? 'text-[var(--color-text-placeholder)] line-through'
                    : 'text-[var(--color-text-secondary)]',
                )}
              >
                {c.item}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Accordion>
  )
}

// ── Policy record ────────────────────────────────────────────────────────────
function PolicyRecord({ runId, policy }: { runId: string; policy: BoundPolicy }) {
  return (
    <div className="rounded-lg border border-[#A7F3D0] bg-[var(--color-success-bg)] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm text-[#065F46]">
          <CheckCircle2 className="size-5" />
          <span>
            Bound — policy{' '}
            <span className="font-mono font-semibold">{policy.policyNumber}</span> (demo record)
          </span>
        </div>
        <a href={`/api/runs/${runId}/quote-pdf`} download className="btn-secondary border-[#A7F3D0] bg-white">
          <Download className="size-4" />
          Download documents
        </a>
      </div>
    </div>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────────────
function Callout({
  tone,
  className,
  children,
}: {
  tone: 'amber' | 'red'
  className?: string
  children: React.ReactNode
}) {
  const styles =
    tone === 'amber'
      ? { border: '#FCD34D', bg: 'var(--color-warning-bg)', fg: '#92400E' }
      : { border: '#FCA5A5', bg: 'var(--color-danger-bg)', fg: '#991B1B' }
  return (
    <div
      className={cn('rounded-md border px-3 py-2.5 text-sm', className)}
      style={{ borderColor: styles.border, background: styles.bg, color: styles.fg }}
    >
      {children}
    </div>
  )
}

function RulePrefix({ outcome }: { outcome: 'pass' | 'fail' | 'refer' }) {
  if (outcome === 'pass')
    return <span className="font-semibold text-[var(--color-success)]" aria-hidden>✓</span>
  if (outcome === 'fail')
    return <span className="font-semibold text-[var(--color-danger)]" aria-hidden>✗</span>
  return <span className="font-semibold text-[var(--color-warning)]" aria-hidden>!</span>
}

function decisionBadge(d: 'in' | 'out' | 'refer'): { label: string; bg: string; fg: string } {
  if (d === 'in') return { label: 'BIND', bg: 'var(--color-success-bg)', fg: '#065F46' }
  if (d === 'out') return { label: 'DECLINE', bg: 'var(--color-danger-bg)', fg: '#991B1B' }
  return { label: 'REFER', bg: 'var(--color-warning-bg)', fg: '#92400E' }
}
