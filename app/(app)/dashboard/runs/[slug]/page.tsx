import { notFound } from 'next/navigation'
import { getRunBySlug } from '@/lib/db/runs'
import { RunDashboard } from '@/components/run/run-dashboard'

export const dynamic = 'force-dynamic'

export default async function RunPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const run = await getRunBySlug(slug)
  if (!run) notFound()

  return (
    <RunDashboard
      runId={run.id}
      slug={run.slug}
      submissionLabel={run.submission_label}
    />
  )
}
