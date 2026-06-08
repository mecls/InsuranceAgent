import { type NextRequest } from 'next/server'
import { readEvents } from '@/lib/events/emit'

// Node runtime: uses the Supabase service-role SDK. Long-lived SSE connection.
export const runtime = 'nodejs'
export const maxDuration = 300

const POLL_MS = 400
const TERMINAL = new Set(['run.completed', 'run.failed'])

/**
 * Streams a run's event log as Server-Sent Events. Replays everything after
 * `?since=<seq>` (default 0 → full replay), then tails the append-only `events`
 * table for new rows. Because live mode and Replay both derive node state purely
 * from this stream, the dashboard uses one code path for both.
 *
 * The client (`useRunStream`) reconnects with the last seen seq, so a dropped
 * connection resumes without gaps.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const sinceParam = req.nextUrl.searchParams.get('since')
  let lastSeq = sinceParam ? Number(sinceParam) || 0 : 0

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          closed = true
        }
      }
      const comment = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`))
        } catch {
          closed = true
        }
      }

      try {
        const deadline = Date.now() + (maxDuration - 5) * 1000
        let sawTerminal = false
        let idleTicks = 0

        while (!closed && !req.signal.aborted && Date.now() < deadline) {
          const batch = await readEvents(runId, lastSeq)
          if (batch.length > 0) {
            idleTicks = 0
            for (const evt of batch) {
              send(evt)
              lastSeq = evt.seq
              if (TERMINAL.has(evt.type)) sawTerminal = true
            }
            if (sawTerminal) break
          } else {
            // Heartbeat roughly every 5s of idleness to keep proxies open.
            idleTicks++
            if (idleTicks % 12 === 0) comment()
          }
          await sleep(POLL_MS)
        }
        send({ type: 'stream.end' })
      } catch (e) {
        if (!req.signal.aborted) {
          console.error('[stream] failed', e)
          send({ type: 'stream.error' })
        }
      } finally {
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
