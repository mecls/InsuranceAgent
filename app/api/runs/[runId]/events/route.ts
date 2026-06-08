import { type NextRequest } from 'next/server'
import { readEvents } from '@/lib/events/emit'

export const runtime = 'nodejs'

/** Returns the full ordered event log for a run — the source for Replay. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const events = await readEvents(runId, 0)
  return Response.json({ events })
}
