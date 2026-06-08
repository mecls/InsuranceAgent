import Link from 'next/link'
import { ArrowRight, Play } from 'lucide-react'
import { listRuns } from '@/lib/db/runs'
import { startDemoRun } from '@/app/actions/runs'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const SCENARIOS = [
  { id: 'clean', label: 'Clean submission', hint: 'Auto-quote path' },
  { id: 'referral', label: 'Referral', hint: 'Knockout → underwriter' },
  { id: 'gappy', label: 'Missing fields', hint: 'Triggers broker email' },
]

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  running: 'bg-[rgb(27_45_190/0.08)] text-[var(--brand-accent)]',
  awaiting_human: 'bg-amber-100 text-amber-700',
  ready: 'bg-green-100 text-green-700',
  failed: 'bg-rose-100 text-rose-700',
}

export default async function DashboardPage() {
  const runs = await listRuns()

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <div className="eyebrow">Underwriting submissions</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Start a run
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Pick a synthetic broker submission. A crew of agents takes it from email
        to quote-ready, live on the node graph.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {SCENARIOS.map((s) => (
          <form key={s.id} action={startDemoRun}>
            <input type="hidden" name="scenario" value={s.id} />
            <button
              type="submit"
              className="group flex w-full flex-col items-start gap-1 rounded-xl border border-black/10 bg-white p-4 text-left transition-colors hover:border-[var(--brand-accent)]"
            >
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--brand-accent)] text-white cta-shadow">
                <Play className="size-4" />
              </span>
              <span className="mt-1 text-sm font-semibold">{s.label}</span>
              <span className="text-xs text-neutral-500">{s.hint}</span>
            </button>
          </form>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold text-neutral-700">
        Recent runs
      </h2>
      <ul className="mt-3 divide-y divide-black/5 overflow-hidden rounded-xl border border-black/10 bg-white">
        {runs.length === 0 && (
          <li className="px-4 py-6 text-sm text-neutral-400">
            No runs yet. Start one above.
          </li>
        )}
        {runs.map((r) => (
          <li key={r.id}>
            <Link
              href={`/dashboard/runs/${r.slug}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {r.submission_label}
                </div>
                <div className="text-xs text-neutral-400 tabular">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_STYLE[r.status] ?? STATUS_STYLE.pending,
                  )}
                >
                  {r.status}
                </span>
                <ArrowRight className="size-4 text-neutral-300" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
