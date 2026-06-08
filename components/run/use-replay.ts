'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunEvent } from '@/lib/events/types'
import { applyEvents, initialRunState, type RunState } from '@/lib/run-state'

const BASE_STEP_MS = 450

/**
 * Replay a finished run by re-streaming its event log through the SAME run state
 * machine the live dashboard uses — so live and Replay share one render path.
 * Drives the Replay scrubber: play/pause, restart, seek, and adjustable speed
 * (invaluable for clean filming takes).
 */
export function useReplay(runId: string, enabled: boolean) {
  const [events, setEvents] = useState<RunEvent[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timer = useRef<number | null>(null)

  // Load the event log once when replay is enabled.
  useEffect(() => {
    if (!enabled) return
    let active = true
    fetch(`/api/runs/${runId}/events`)
      .then((r) => r.json())
      .then((d: { events: RunEvent[] }) => {
        if (!active) return
        setEvents(d.events ?? [])
        setIndex(0)
        setPlaying(true)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [runId, enabled])

  // Advance while playing. When the playhead reaches the end we simply stop
  // scheduling (no setState in the effect); `atEnd` reflects the stopped state.
  const atEnd = events.length > 0 && index >= events.length
  useEffect(() => {
    if (!playing || atEnd) return
    timer.current = window.setTimeout(
      () => setIndex((i) => Math.min(i + 1, events.length)),
      BASE_STEP_MS / speed,
    )
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [playing, atEnd, index, events.length, speed])

  const state: RunState = useMemo(
    () => applyEvents(initialRunState(), events.slice(0, index)),
    [events, index],
  )

  return {
    state,
    total: events.length,
    index,
    // Effective playing: false once the playhead is parked at the end.
    playing: playing && !atEnd,
    speed,
    play: () => {
      if (atEnd) setIndex(0)
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    restart: () => {
      setIndex(0)
      setPlaying(true)
    },
    seek: (i: number) => {
      setPlaying(false)
      setIndex(Math.max(0, Math.min(i, events.length)))
    },
    setSpeed,
  }
}
