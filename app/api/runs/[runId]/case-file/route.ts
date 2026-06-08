import { type NextRequest } from 'next/server'
import { getRunById } from '@/lib/db/runs'

export const runtime = 'nodejs'

/**
 * Returns the run's current Case File + status. The review surface fetches this
 * once the live stream reports the run is ready, to render the quote, dossier,
 * appetite rationale, and audit trail.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const run = await getRunById(runId)
  if (!run) return new Response('not found', { status: 404 })
  return Response.json({
    status: run.status,
    caseFile: run.case_file,
    boundPolicy: run.bound_policy,
  })
}
