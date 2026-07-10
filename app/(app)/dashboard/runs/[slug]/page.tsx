import { notFound } from 'next/navigation'
import { getRunBySlug } from '@/lib/db/runs'
import { RunDetail } from '@/components/run/run-detail'

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
    <RunDetail
      runId={run.id}
      slug={run.slug}
      submissionLabel={run.case_file?.request?.summary ?? run.submission_label}
    />
  )
}
