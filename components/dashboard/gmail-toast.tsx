'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type Tone = 'success' | 'error' | 'neutral'

const RESULTS: Record<string, { tone: Tone; text: string }> = {
  connected: { tone: 'success', text: 'Gmail connected. Pick a thread to import.' },
  denied: { tone: 'neutral', text: 'Gmail connection cancelled.' },
  notoken: {
    tone: 'error',
    text: 'Google did not return a refresh token. Reconnect and approve consent.',
  },
  error: { tone: 'error', text: 'Could not connect Gmail. Please try again.' },
}

/**
 * Surfaces the result of the Connect Gmail OAuth callback (which redirects to
 * /dashboard?gmail=<result>), then strips the param so it doesn't reappear on
 * refresh. Reads the URL on mount (no useSearchParams → no Suspense boundary).
 */
export function GmailToast() {
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null)

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('gmail')
    if (!result || !(result in RESULTS)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the OAuth callback result on mount
    setMsg(RESULTS[result])

    const url = new URL(window.location.href)
    url.searchParams.delete('gmail')
    window.history.replaceState(null, '', url.toString())

    const t = window.setTimeout(() => setMsg(null), 6000)
    return () => window.clearTimeout(t)
  }, [])

  if (!msg) return null

  const Icon = msg.tone === 'success' ? CheckCircle2 : msg.tone === 'error' ? AlertTriangle : Info
  const color =
    msg.tone === 'success'
      ? 'var(--color-success)'
      : msg.tone === 'error'
        ? 'var(--color-danger)'
        : 'var(--color-text-muted)'

  return (
    <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-[var(--color-border)] bg-white px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
      <Icon className="mt-0.5 size-4 shrink-0" style={{ color }} />
      <p className="flex-1 text-sm text-[var(--color-text-secondary)]">{msg.text}</p>
      <button
        onClick={() => setMsg(null)}
        className="rounded p-0.5 text-[var(--color-text-placeholder)] hover:bg-neutral-100 hover:text-[var(--color-text-secondary)]"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
