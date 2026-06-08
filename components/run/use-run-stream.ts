'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { RunEvent } from '@/lib/events/types'
import { applyEvent, initialRunState, type RunState } from '@/lib/run-state'

type Action = { kind: 'reset' } | { kind: 'event'; evt: RunEvent }

function reducer(state: RunState, action: Action): RunState {
  if (action.kind === 'reset') return initialRunState()
  return applyEvent(state, action.evt)
}

/**
 * Consumes the SSE stream at /api/runs/[runId]/stream and folds each event into
 * the run state machine. Reconnects with the last seen seq so a dropped
 * connection resumes without gaps. Used for live runs; the same hook drives
 * Replay by re-streaming from since=0 at an adjustable cadence (Phase 4).
 */
export function useRunStream(runId: string, enabled = true) {
  const [state, dispatch] = useReducer(reducer, undefined, initialRunState)
  const [connected, setConnected] = useState(false)
  const lastSeqRef = useRef(0)

  const reset = useCallback(() => {
    lastSeqRef.current = 0
    dispatch({ kind: 'reset' })
  }, [])

  useEffect(() => {
    if (!enabled || !runId) return
    let abort: AbortController | null = null
    let stopped = false

    const connect = async () => {
      abort = new AbortController()
      try {
        const res = await fetch(
          `/api/runs/${runId}/stream?since=${lastSeqRef.current}`,
          { signal: abort.signal },
        )
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
        setConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            let payload: { seq?: number }
            try {
              payload = JSON.parse(dataLine.slice(6))
            } catch {
              continue
            }
            // Real events carry a numeric `seq`; control frames
            // ({type:'stream.end'|'stream.error'}) do not — skip those.
            if (typeof payload.seq === 'number') {
              lastSeqRef.current = payload.seq
              dispatch({ kind: 'event', evt: payload as unknown as RunEvent })
            }
          }
        }
      } catch {
        // network blip or server cycling — fall through to reconnect
      } finally {
        setConnected(false)
      }

      // Reconnect unless we unmounted; the server closes on terminal events, so
      // a reconnect after completion just replays nothing and idles out.
      if (!stopped) {
        await new Promise((r) => setTimeout(r, 600))
        if (!stopped) void connect()
      }
    }

    void connect()
    return () => {
      stopped = true
      abort?.abort()
    }
  }, [runId, enabled])

  return { state, connected, reset }
}
