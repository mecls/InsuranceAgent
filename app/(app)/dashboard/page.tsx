import { listRuns } from '@/lib/db/runs'
import { getAutomate } from '@/lib/db/settings'
import { listCatalogItems, type CatalogItem } from '@/lib/db/catalog'
import { NewCase } from '@/components/dashboard/new-submission'
import { AutomateToggle } from '@/components/dashboard/automate-toggle'
import { CatalogEditor } from '@/components/dashboard/catalog-editor'
import { DraftsInbox, type DraftSummary } from '@/components/dashboard/drafts-inbox'
import { GmailToast } from '@/components/dashboard/gmail-toast'
import { StatsBar } from '@/components/dashboard/stats-bar'
import { SubmissionsTabs, type RunSummary } from '@/components/dashboard/submissions-tabs'

export const dynamic = 'force-dynamic'

async function loadCatalog(): Promise<CatalogItem[]> {
  // Tolerant: before migration 0008 the table may not exist yet.
  try {
    return await listCatalogItems(false)
  } catch {
    return []
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function buildStats(summaries: RunSummary[], drafts: number) {
  const now = Date.now()
  return {
    thisWeek: summaries.filter((s) => now - new Date(s.createdAt).getTime() < WEEK_MS).length,
    drafts,
    inProgress: summaries.filter((s) => s.status === 'running' || s.status === 'awaiting_human').length,
    sent: summaries.filter((s) => s.sent).length,
  }
}

export default async function DashboardPage() {
  const [runs, automate, catalog] = await Promise.all([listRuns(100), getAutomate(), loadCatalog()])

  const customerOf = (r: (typeof runs)[number]) =>
    r.case_file?.customer?.name ?? r.case_file?.customer?.contact ?? null

  const drafts: DraftSummary[] = runs
    .filter((r) => r.status === 'pending')
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      summary: r.case_file?.request?.summary ?? r.submission_label,
      channel: r.case_file?.customer?.channel ?? 'form',
      customer: customerOf(r),
    }))

  const summaries: RunSummary[] = runs
    .filter((r) => r.status !== 'pending')
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.case_file?.request?.summary ?? r.submission_label,
      status: r.status,
      sent: r.case_file?.sent != null,
      customer: customerOf(r),
      createdAt: r.created_at,
      readyAt: r.ready_at,
    }))

  const stats = buildStats(summaries, drafts.length)

  return (
    <div className="h-full overflow-y-auto">
      <GmailToast />
      <div className="mx-auto max-w-[900px] px-5 py-8">
        <section>
          <AutomateToggle initial={automate} />
        </section>

        <section className="mt-6">
          <div className="eyebrow mb-2">Pedidos recebidos</div>
          <DraftsInbox drafts={drafts} />
        </section>

        <section className="mt-8">
          <div className="eyebrow mb-2">Abrir um caso</div>
          <NewCase />
        </section>

        <section className="mt-8">
          <StatsBar {...stats} />
        </section>

        {catalog.length > 0 && (
          <section className="mt-8">
            <CatalogEditor items={catalog} />
          </section>
        )}

        <section className="mt-8">
          <SubmissionsTabs runs={summaries} />
        </section>
      </div>
    </div>
  )
}
