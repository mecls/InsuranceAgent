/** Small display formatters shared by the dashboard. */

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

export function formatElapsed(
  startedAt: number | undefined,
  endedAt: number | undefined,
  now: number,
): string {
  if (!startedAt) return '0.0s'
  const end = endedAt ?? now
  return formatDuration(end - startedAt)
}

export function formatCurrency(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${Math.round(value).toLocaleString()}`
  }
}
