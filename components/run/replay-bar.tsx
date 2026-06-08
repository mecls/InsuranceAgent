'use client'

import { Play, Pause, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReplayBarProps {
  total: number
  index: number
  playing: boolean
  speed: number
  play: () => void
  pause: () => void
  restart: () => void
  seek: (i: number) => void
  setSpeed: (s: number) => void
  onExit: () => void
}

const SPEEDS = [1, 2, 4]

export function ReplayBar(p: ReplayBarProps) {
  return (
    <div className="flex items-center gap-3 border-t border-black/10 bg-white px-5 py-2.5">
      <span className="rounded-full bg-[var(--brand-accent)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
        Replay
      </span>

      <button
        onClick={p.playing ? p.pause : p.play}
        className="grid size-8 place-items-center rounded-lg bg-neutral-900 text-white"
        aria-label={p.playing ? 'Pause' : 'Play'}
      >
        {p.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button
        onClick={p.restart}
        className="grid size-8 place-items-center rounded-lg border border-black/10 text-neutral-600 hover:bg-neutral-50"
        aria-label="Restart"
      >
        <RotateCcw className="size-4" />
      </button>

      <input
        type="range"
        min={0}
        max={p.total}
        value={p.index}
        onChange={(e) => p.seek(Number(e.target.value))}
        className="flex-1 accent-[var(--brand-accent)]"
      />
      <span className="tabular text-xs text-neutral-500">
        {p.index}/{p.total}
      </span>

      <div className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => p.setSpeed(s)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium',
              p.speed === s
                ? 'bg-[var(--brand-accent)] text-white'
                : 'text-neutral-500 hover:bg-neutral-100',
            )}
          >
            {s}×
          </button>
        ))}
      </div>

      <button
        onClick={p.onExit}
        className="ml-1 grid size-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        aria-label="Exit replay"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
