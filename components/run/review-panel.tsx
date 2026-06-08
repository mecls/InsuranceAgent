'use client'

import { useEffect, useState } from 'react'
import { X, FileText, Scale, Globe, ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { bindQuote } from '@/app/actions/runs'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ReviewPanelProps {
  runId: string
  onClose: () => void
}

interface CaseFileResponse {
  status: string
  caseFile: CaseFile | null
  boundPolicy: { policyNumber: string; boundAt: string } | null
}

export function ReviewPanel({ runId, onClose }: ReviewPanelProps) {
  const [data, setData] = useState<CaseFileResponse | null>(null)
  const [premium, setPremium] = useState<string>('')
  const [binding, setBinding] = useState(false)
  const [policy, setPolicy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/runs/${runId}/case-file`)
      .then((r) => r.json())
      .then((d: CaseFileResponse) => {
        if (!active) return
        setData(d)
        setPolicy(d.boundPolicy?.policyNumber ?? null)
        if (d.caseFile?.quote?.premium != null) {
          setPremium(String(d.caseFile.quote.premium))
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [runId])

  const cf = data?.caseFile
  const onBind = async () => {
    setBinding(true)
    try {
      const override = Number(premium)
      const res = await bindQuote(
        runId,
        Number.isFinite(override) && override !== cf?.quote?.premium ? override : undefined,
      )
      setPolicy(res.policyNumber)
    } finally {
      setBinding(false)
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/20">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <div>
            <div className="eyebrow">Underwriter review</div>
            <h2 className="text-base font-semibold">{cf?.submission.insured?.name ?? 'Submission'}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close review"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-auto p-5">
          {!cf ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="size-4 animate-spin" /> Loading case file…
            </div>
          ) : (
            <>
              {/* Quote */}
              <Section icon={<FileText className="size-4" />} title="Indicative quote">
                {cf.declined ? (
                  <p className="text-sm text-rose-700">
                    Declined — out of appetite. No quote produced.
                  </p>
                ) : cf.quote ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular">
                        {formatCurrency(cf.quote.premium, cf.quote.currency)}
                      </span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                        SIMULATED RATING
                      </span>
                    </div>
                    {cf.quote.summary && (
                      <p className="text-sm text-neutral-600">{cf.quote.summary}</p>
                    )}
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {cf.quote.ratingBreakdown.map((b, i) => (
                          <tr key={i} className="border-t border-black/5">
                            <td className="py-1 text-neutral-600">{b.label}</td>
                            <td className="py-1 text-right tabular">
                              {b.kind === 'modifier' ? `×${b.value}` : formatCurrency(b.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-400">No quote.</p>
                )}
              </Section>

              {/* Appetite */}
              {cf.appetite && (
                <Section icon={<Scale className="size-4" />} title="Appetite & risk">
                  <div className="mb-2 flex items-center gap-2">
                    <DecisionBadge decision={cf.appetite.decision} />
                    <span className="text-xs text-neutral-500 tabular">
                      score {cf.appetite.score.toFixed(2)}
                    </span>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-neutral-700">
                    {cf.appetite.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Dossier */}
              {cf.enrichment && (
                <Section icon={<Globe className="size-4" />} title="Research dossier">
                  <p className="whitespace-pre-line text-sm text-neutral-700">
                    {cf.enrichment.dossier}
                  </p>
                  {cf.enrichment.citations.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs">
                      {cf.enrichment.citations.map((c, i) => (
                        <li key={i}>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--brand-accent)] hover:underline"
                          >
                            [{i + 1}] {c.title ?? c.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {/* Audit */}
              {cf.audit && (
                <Section icon={<ShieldCheck className="size-4" />} title="Compliance & audit">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        cf.audit.compliance === 'pass'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700',
                      )}
                    >
                      {cf.audit.compliance.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-700">{cf.audit.summary}</p>
                  {cf.audit.flags.length > 0 && (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-amber-700">
                      {cf.audit.flags.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {/* Pre-bind checklist */}
              {cf.quote?.preBindChecklist && cf.quote.preBindChecklist.length > 0 && (
                <Section icon={<FileText className="size-4" />} title="Pre-bind checklist">
                  <ul className="space-y-1 text-sm text-neutral-700">
                    {cf.quote.preBindChecklist.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-neutral-300">☐</span>
                        {c.item}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Bind bar (gated) */}
        {cf && !cf.declined && (
          <footer className="border-t border-black/10 p-4">
            {policy ? (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-800">
                <CheckCircle2 className="size-4" />
                Bound — policy <span className="font-semibold tabular">{policy}</span> (demo record)
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label className="text-xs text-neutral-500">
                  Bound premium
                  <input
                    value={premium}
                    onChange={(e) => setPremium(e.target.value)}
                    inputMode="numeric"
                    className="ml-2 w-28 rounded-md border border-black/15 px-2 py-1 text-sm tabular"
                  />
                </label>
                <button
                  onClick={onBind}
                  disabled={binding}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[var(--brand-accent)] px-4 py-2 text-sm font-semibold text-white cta-shadow disabled:opacity-60"
                >
                  {binding && <Loader2 className="size-4 animate-spin" />}
                  Bind quote
                </button>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
        <span className="text-neutral-400">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  )
}

function DecisionBadge({ decision }: { decision: 'in' | 'out' | 'refer' }) {
  const map = {
    in: 'bg-green-100 text-green-700',
    refer: 'bg-amber-100 text-amber-700',
    out: 'bg-rose-100 text-rose-700',
  }
  const label = { in: 'IN APPETITE', refer: 'REFER', out: 'OUT OF APPETITE' }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', map[decision])}>
      {label[decision]}
    </span>
  )
}
