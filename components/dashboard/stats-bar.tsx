interface StatsBarProps {
  thisWeek: number
  drafts: number
  inProgress: number
  sent: number
}

/** Real-time snapshot of the quoting desk. */
export function StatsBar({ thisWeek, drafts, inProgress, sent }: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4">
      <Stat label="Esta semana" value={thisWeek} />
      <Stat label="Por iniciar" value={drafts} />
      <Stat label="Em curso" value={inProgress} />
      <Stat label="Enviados" value={sent} accent />
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-[#F8F9FB] px-6 py-4">
      <div className="eyebrow">{label}</div>
      <div
        className="mt-1 text-2xl font-semibold tabular"
        style={{ color: accent ? 'var(--color-success)' : 'var(--color-text-primary)' }}
      >
        {value}
      </div>
    </div>
  )
}
