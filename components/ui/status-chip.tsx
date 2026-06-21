import { cn } from '@/lib/utils'

/** Effective status used across the dashboard + run detail. */
export type DisplayStatus = 'ready' | 'running' | 'pending' | 'error' | 'bound'

/** Map a run row (status + bound flag) to a single display status. */
export function displayStatus(status: string, bound: boolean): DisplayStatus {
  if (bound) return 'bound'
  if (status === 'ready') return 'ready'
  if (status === 'running' || status === 'awaiting_human') return 'running'
  if (status === 'failed' || status === 'error') return 'error'
  return 'pending'
}

const META: Record<DisplayStatus, { label: string; cls: string; pulse?: boolean }> = {
  ready: { label: 'Quote Ready', cls: 'chip-ready' },
  running: { label: 'Processing', cls: 'chip-running', pulse: true },
  pending: { label: 'Pending', cls: 'chip-pending' },
  error: { label: 'Failed', cls: 'chip-error' },
  bound: { label: 'Bound ✓', cls: 'chip-bound' },
}

export function StatusChip({
  status,
  className,
}: {
  status: DisplayStatus
  className?: string
}) {
  const m = META[status]
  return (
    <span className={cn('chip', m.cls, className)}>
      {m.pulse && <span className="pulse-dot" />}
      {m.label}
    </span>
  )
}
