import { cn } from '@/lib/utils'

/** Effective status used across the dashboard + run detail. */
export type DisplayStatus = 'ready' | 'running' | 'pending' | 'error' | 'bound'

/** Map a run row (status + awarded flag) to a single display status. */
export function displayStatus(status: string, awarded: boolean): DisplayStatus {
  if (awarded) return 'bound'
  if (status === 'ready') return 'ready'
  if (status === 'running' || status === 'awaiting_human') return 'running'
  if (status === 'failed' || status === 'error') return 'error'
  return 'pending'
}

const META: Record<DisplayStatus, { label: string; cls: string; pulse?: boolean }> = {
  ready: { label: 'Pronto a rever', cls: 'chip-ready' },
  running: { label: 'Em curso', cls: 'chip-running', pulse: true },
  pending: { label: 'Pendente', cls: 'chip-pending' },
  error: { label: 'Falhou', cls: 'chip-error' },
  bound: { label: 'Enviado ✓', cls: 'chip-bound' },
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
