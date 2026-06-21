import { listRuns } from '@/lib/db/runs'
import { NewSubmission } from '@/components/dashboard/new-submission'
import { GmailToast } from '@/components/dashboard/gmail-toast'
import { StatsBar } from '@/components/dashboard/stats-bar'
import { SubmissionsTabs, type RunSummary } from '@/components/dashboard/submissions-tabs'

export const dynamic = 'force-dynamic'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Request-time KPI rollup. Kept out of the component so the time read is fine. */
function buildStats(summaries: RunSummary[]) {
  const now = Date.now()
  return {
    thisWeek: summaries.filter((s) => now - new Date(s.createdAt).getTime() < WEEK_MS).length,
    quoteReady: summaries.filter((s) => s.status === 'ready' && !s.bound).length,
    inProgress: summaries.filter((s) => s.status === 'running' || s.status === 'awaiting_human').length,
    bound: summaries.filter((s) => s.bound).length,
  }
}

export default async function DashboardPage() {
  const runs = await listRuns(100)

  const summaries: RunSummary[] = runs.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.submission_label,
    insuredName: r.case_file?.submission?.insured?.name ?? null,
    brokerName: r.case_file?.submission?.broker?.name ?? null,
    status: r.status,
    bound: r.bound_policy != null,
    policyNumber: r.bound_policy?.policyNumber ?? null,
    createdAt: r.created_at,
    readyAt: r.ready_at,
  }))

  const stats = buildStats(summaries)

  return (
    <div className="h-full overflow-y-auto">
      <GmailToast />
      <div className="mx-auto max-w-[900px] px-5 py-8">
      {/* Section 1 — New submission */}
      <section>
        <div className="eyebrow mb-2">New Submission</div>
        <NewSubmission />
      </section>

      {/* Section 2 — Summary stats */}
      <section className="mt-8">
        <StatsBar {...stats} />
      </section>

      {/* Section 3 — Submissions & runs */}
      <section className="mt-8">
        <SubmissionsTabs runs={summaries} />
      </section>
      </div>
    </div>
  )
}
