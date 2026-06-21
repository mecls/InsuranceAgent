interface StatsBarProps {
  thisWeek: number
  quoteReady: number
  inProgress: number
  bound: number
}

/** Real-time snapshot of the underwriting desk. */
export function StatsBar({ thisWeek, quoteReady, inProgress, bound }: StatsBarProps) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4">
      <Stat label="This Week" value={thisWeek} />
      <Stat label="Quote Ready" value={quoteReady} />
      <Stat label="In Progress" value={inProgress} />
      <Stat label="Bound" value={bound} accent />
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
