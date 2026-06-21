'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ReactFlowProvider } from '@xyflow/react'
import { Clock, History, Download, Loader2, Mail } from 'lucide-react'
import { useRunStream } from './use-run-stream'
import { useReplay } from './use-replay'
import { RunGraph } from '@/components/graph/run-graph'
import { DetailPanel } from '@/components/graph/detail-panel'
import { ReplayBar } from './replay-bar'
import { GapApprovalBanner } from './gap-approval-banner'
import { RunReview } from './review-sections'
import { StatusChip, type DisplayStatus } from '@/components/ui/status-chip'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { type NodeId } from '@/lib/underwriting/nodes'
import { formatElapsed } from '@/lib/format'
import { SITE_CONFIG } from '@/lib/site-config'
import { cn } from '@/lib/utils'

interface CaseFileResponse {
  status: string
  caseFile: CaseFile | null
  boundPolicy: { policyNumber: string; boundAt: string } | null
}

type View = 'flow' | 'quote'

export function RunDetail({
  runId,
  submissionLabel,
  insuredName,
}: {
  runId: string
  slug: string
  submissionLabel: string
  insuredName: string | null
}) {
  const { state: liveState } = useRunStream(runId)
  const [replayMode, setReplayMode] = useState(false)
  const replay = useReplay(runId, replayMode)
  const traceState = replayMode ? replay.state : liveState

  const [data, setData] = useState<CaseFileResponse | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [view, setView] = useState<View>('flow')
  const [selected, setSelected] = useState<NodeId | null>(null)
  const didAutoSwitch = useRef(false)

  const phase = liveState.phase
  const ready = phase === 'ready'

  const fetchCase = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${runId}/case-file`)
      setData(await r.json())
    } catch {
      /* ignore */
    }
  }, [runId])

  // Data fetch: on mount, on every phase change, and polled while live.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await
    void fetchCase()
    if (phase !== 'running') return
    const id = window.setInterval(fetchCase, 3000)
    return () => window.clearInterval(id)
  }, [phase, fetchCase])

  // Tick the elapsed clock while live.
  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [phase])

  const cf = data?.caseFile ?? null
  const bound = data?.boundPolicy != null
  const hasReview = !!(cf && (cf.quote || cf.declined || cf.appetite || cf.audit))

  // Auto-switch to the Quote once, when the run finishes and review data exists.
  useEffect(() => {
    if (!didAutoSwitch.current && ready && hasReview) {
      didAutoSwitch.current = true
      setView('quote')
    }
  }, [ready, hasReview])

  const elapsed = formatElapsed(traceState.startedAt, traceState.endedAt, now)
  const ds: DisplayStatus = bound
    ? 'bound'
    : phase === 'ready'
      ? 'ready'
      : phase === 'failed'
        ? 'error'
        : phase === 'running'
          ? 'running'
          : 'pending'
  const name = insuredName ?? cf?.submission.insured?.name ?? submissionLabel

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header bar */}
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[var(--color-border)] bg-white px-5 py-3">
        <nav className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
          <Link href="/dashboard" className="hover:text-[var(--color-text-secondary)]">
            Dashboard
          </Link>
          <span className="text-[var(--color-text-placeholder)]">›</span>
          <span className="font-medium text-[var(--color-text-primary)]">{name}</span>
          {cf?.submission.source?.type === 'gmail' && cf.submission.source.permalink && (
            <a
              href={cf.submission.source.permalink}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-1 rounded-md bg-[var(--color-brand-light)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              <Mail className="size-3" /> View in Gmail
            </a>
          )}
        </nav>

        <div className="flex items-center gap-4">
          {/* Flow / Quote toggle */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#F1F3F6] p-1">
            <ToggleBtn active={view === 'flow'} onClick={() => setView('flow')}>
              Flow
            </ToggleBtn>
            <ToggleBtn
              active={view === 'quote'}
              disabled={!hasReview}
              onClick={() => setView('quote')}
            >
              Quote
            </ToggleBtn>
          </div>

          <StatusChip status={ds} />

          <div className="hidden items-center gap-2 text-xs text-[var(--color-text-muted)] lg:flex">
            <Clock className="size-3.5 shrink-0 text-[var(--color-text-placeholder)]" />
            <span className="tabular font-semibold text-[var(--color-text-primary)]">{elapsed}</span>
            <span>vs {SITE_CONFIG.manualBaselineLabel}</span>
          </div>

          {view === 'flow' && ready && !replayMode && (
            <button onClick={() => setReplayMode(true)} className="btn-ghost whitespace-nowrap">
              <History className="size-3.5 shrink-0" /> Replay
            </button>
          )}
          {hasReview && (
            <a
              href={`/api/runs/${runId}/quote-pdf`}
              download
              className="btn-secondary whitespace-nowrap"
            >
              <Download className="size-4 shrink-0" /> Download Quote
            </a>
          )}
        </div>
      </header>

      {!replayMode && liveState.nodes.gap.status === 'awaiting_human' && (
        <GapApprovalBanner runId={runId} gap={liveState.nodes.gap} />
      )}

      {/* Body — full-screen flow OR the quote review */}
      <div className="min-h-0 flex-1">
        {view === 'flow' ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1">
                <ReactFlowProvider>
                  <RunGraph state={traceState} selected={selected} onSelect={setSelected} />
                </ReactFlowProvider>
              </div>
              {selected && (
                <DetailPanel
                  nodeId={selected}
                  node={traceState.nodes[selected]}
                  onClose={() => setSelected(null)}
                />
              )}
            </div>
            {replayMode && (
              <ReplayBar
                total={replay.total}
                index={replay.index}
                playing={replay.playing}
                speed={replay.speed}
                play={replay.play}
                pause={replay.pause}
                restart={replay.restart}
                seek={replay.seek}
                setSpeed={replay.setSpeed}
                onExit={() => setReplayMode(false)}
              />
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[900px] px-5 py-8">
              {cf ? (
                <RunReview
                  runId={runId}
                  caseFile={cf}
                  boundPolicy={data?.boundPolicy ?? null}
                  onBound={fetchCase}
                />
              ) : (
                <div className="card flex items-center justify-center gap-2 px-6 py-16 text-sm text-[var(--color-text-muted)]">
                  <Loader2 className="size-4 animate-spin" />
                  Loading…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-md px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all',
        active
          ? 'bg-white text-[var(--color-brand)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
          : 'text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--color-text-muted)]',
      )}
    >
      {children}
    </button>
  )
}
