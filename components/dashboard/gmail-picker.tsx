'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mail, Search, Paperclip, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface GmailThreadMeta {
  threadId: string
  permalink: string
  from: { name?: string; address?: string }
  subject: string
  text: string
  attachments: { filename: string; mimeType: string; sizeBytes: number }[]
}

interface ThreadSummary {
  threadId: string
  subject: string
  from: string
  date: string
  snippet: string
  hasAttachment: boolean
}
interface ThreadsResponse {
  connected: boolean
  email?: string
  threads?: ThreadSummary[]
  error?: string
}

const DEFAULT_QUERY = 'has:attachment newer_than:1y'

/**
 * Modal thread picker for the submission composer. Lists candidate Gmail threads,
 * and on "Add" fetches the selected thread's metadata (sender, body, attachment
 * names — no bytes) and hands it back via `onAdd`. The composer adds those
 * documents to the run and hydrates the broker fields. Read-only; never sends.
 */
export function GmailPicker({
  open,
  onClose,
  onAdd,
  addedThreadIds,
}: {
  open: boolean
  onClose: () => void
  onAdd: (meta: GmailThreadMeta) => void
  addedThreadIds: string[]
}) {
  const [data, setData] = useState<ThreadsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/gmail/threads?q=${encodeURIComponent(q)}`)
      setData(await r.json())
    } catch {
      setData({ connected: true, threads: [], error: 'Could not reach Gmail.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; setState runs after await
    if (open) void load(DEFAULT_QUERY)
  }, [open, load])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function add() {
    if (!selected) return
    setAdding(true)
    setAddError(null)
    try {
      const r = await fetch(`/api/gmail/threads/${selected}`)
      const j = (await r.json()) as { meta?: GmailThreadMeta; error?: string }
      if (j.error || !j.meta) {
        setAddError(j.error ?? 'Could not read that thread.')
        return
      }
      onAdd(j.meta)
      setSelected(null)
      onClose()
    } catch {
      setAddError('Could not read that thread.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-2xl flex-col p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import documents from Gmail"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Mail className="size-3.5 text-[var(--color-success)]" />
            {data?.email ? (
              <span>
                Connected as{' '}
                <span className="font-medium text-[var(--color-text-secondary)]">{data.email}</span>
              </span>
            ) : (
              <span>Import from Gmail</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-neutral-100 hover:text-[var(--color-text-primary)]"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Not connected */}
        {!loading && data && !data.connected ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-[var(--color-brand-light)] text-[var(--color-brand)]">
              <Mail className="size-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                Connect Gmail to import submissions
              </div>
              <p className="mt-1 max-w-sm text-xs text-[var(--color-text-muted)]">
                Read-only access. Pick a broker thread and its message + attachments are added to
                this submission. We never send email on your behalf.
              </p>
            </div>
            <a href="/api/gmail/oauth/start" className="btn-primary">
              <Mail className="size-4" /> Connect Gmail
            </a>
          </div>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void load(query)
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-placeholder)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Gmail (e.g. from:broker has:attachment)"
                  className="input"
                  style={{ paddingLeft: '2.25rem' }}
                />
              </div>
              <button type="submit" className="btn-secondary" disabled={loading}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Search
              </button>
            </form>

            <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-[var(--color-border)]">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-text-muted)]">
                  <Loader2 className="size-4 animate-spin" /> Loading threads…
                </div>
              ) : data?.error ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--color-danger)]">
                  {data.error}
                </div>
              ) : (data?.threads?.length ?? 0) === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
                  No matching threads. Adjust your search.
                </div>
              ) : (
                data!.threads!.map((t) => {
                  const already = addedThreadIds.includes(t.threadId)
                  return (
                    <button
                      key={t.threadId}
                      type="button"
                      disabled={already}
                      onClick={() => setSelected(t.threadId)}
                      className={cn(
                        'flex w-full items-start gap-3 border-b border-[#F3F4F6] px-3.5 py-3 text-left transition-colors last:border-0',
                        already
                          ? 'cursor-default opacity-50'
                          : selected === t.threadId
                            ? 'bg-[var(--color-brand-light)]'
                            : 'hover:bg-[#F9FAFB]',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1 size-3.5 shrink-0 rounded-full border',
                          selected === t.threadId
                            ? 'border-[var(--color-brand)] bg-[var(--color-brand)] ring-2 ring-[var(--color-brand-light)]'
                            : 'border-[var(--color-border-input)]',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                            {t.subject}
                          </span>
                          {t.hasAttachment && (
                            <Paperclip className="size-3 shrink-0 text-[var(--color-text-placeholder)]" />
                          )}
                          {already && (
                            <span className="shrink-0 text-[11px] font-medium text-[var(--color-text-placeholder)]">
                              Added
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-[var(--color-text-muted)]">
                          {fromName(t.from)}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-[var(--color-text-placeholder)]">
                          {t.snippet}
                        </div>
                      </div>
                      <span className="tabular shrink-0 text-xs text-[var(--color-text-placeholder)]">
                        {fmtDate(t.date)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {addError && (
              <div className="mt-2 text-xs text-[var(--color-danger)]">{addError}</div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void add()}
                disabled={!selected || adding}
                className="btn-primary"
              >
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add to submission
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function fromName(from: string): string {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/)
  if (m) return m[1]?.trim() || m[2]
  return from
}

function fmtDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
