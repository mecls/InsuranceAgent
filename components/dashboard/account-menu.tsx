'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, Loader2, LogOut, Check } from 'lucide-react'

interface Status {
  connected: boolean
  email?: string
}

/**
 * Account avatar + dropdown in the top nav. Surfaces the Gmail connection so it
 * can be managed from anywhere in the app: shows the connected account with a
 * Disconnect action, or a Connect Gmail link when none is linked.
 */
export function AccountMenu({ initial }: { initial: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/gmail/status')
      setStatus((await r.json()) as Status)
    } catch {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  // Load status when the menu opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState runs after await
    if (open && status === null) void refresh()
  }, [open, status, refresh])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch('/api/gmail/disconnect', { method: 'POST' })
      setStatus({ connected: false })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid size-7 place-items-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white transition-shadow hover:ring-2 hover:ring-[var(--color-brand-light)]"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
        >
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-placeholder)]">
            Gmail
          </div>

          {loading || status === null ? (
            <div className="flex items-center gap-2 px-1 py-2 text-sm text-[var(--color-text-muted)]">
              <Loader2 className="size-4 animate-spin" /> Checking…
            </div>
          ) : status.connected ? (
            <>
              <div className="flex items-start gap-2 rounded-md bg-[#F9FAFB] px-2.5 py-2">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-success)]" />
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--color-text-muted)]">Connected as</div>
                  <div className="truncate text-sm font-medium text-[var(--color-text-secondary)]">
                    {status.email ?? 'Gmail account'}
                  </div>
                </div>
              </div>
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--color-danger)] transition-colors hover:bg-[#FEF2F2]"
              >
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                Disconnect Gmail
              </button>
            </>
          ) : (
            <>
              <p className="px-1 pb-2 text-xs text-[var(--color-text-muted)]">
                Connect a mailbox (read-only) to import broker submissions straight from Gmail.
              </p>
              <a
                href="/api/gmail/oauth/start"
                className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-brand)] px-2.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                <Mail className="size-4" /> Connect Gmail
              </a>
            </>
          )}
        </div>
      )}
    </div>
  )
}
