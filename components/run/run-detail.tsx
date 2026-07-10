'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ReactFlowProvider } from '@xyflow/react'
import { Clock, History, Download, Loader2 } from 'lucide-react'
import { useRunStream } from './use-run-stream'
import { useReplay } from './use-replay'
import { RunGraph } from '@/components/graph/run-graph'
import { DetailPanel } from '@/components/graph/detail-panel'
import { ReplayBar } from './replay-bar'
import { GateBanner } from './gate-banner'
import { RunReview } from './review-sections'
import { StatusChip, type DisplayStatus } from '@/components/ui/status-chip'
import type { CaseFile } from '@/lib/procurement/case-file'
import { type NodeId } from '@/lib/procurement/nodes'
import { formatElapsed } from '@/lib/format'
import { SITE_CONFIG } from '@/lib/site-config'
import { cn } from '@/lib/utils'

interface CaseFileResponse {
  status: string
  caseFile: CaseFile | null
}

type View = 'flow' | 'quote'

export function RunDetail({
  runId,
  submissionLabel,
}: {
  runId: string
  slug: string
  submissionLabel: string
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
  const awaitOpen = liveState.nodes['await-customer'].status === 'awaiting_human'
  const reviewOpen = liveState.nodes.review.status === 'awaiting_human'

  const fetchCase = useCallback(async () => {
    try {
      const r = await fetch(`/api/runs/${runId}/case-file`)
      setData(await r.json())
    } catch {
      /* ignore */
    }
  }, [runId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await
    void fetchCase()
    if (phase !== 'running') return
    const id = window.setInterval(fetchCase, 3000)
    return () => window.clearInterval(id)
  }, [phase, fetchCase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch; setState runs after await
    if (reviewOpen) void fetchCase()
  }, [reviewOpen, fetchCase])

  useEffect(() => {
    if (phase !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [phase])

  const cf = data?.caseFile ?? null
  const sent = !!cf?.sent
  const hasQuote = !!(cf && (cf.lineItems?.length || cf.quote || cf.sent || cf.closedWithoutQuote))

  useEffect(() => {
    if (!didAutoSwitch.current && hasQuote && (reviewOpen || ready)) {
      didAutoSwitch.current = true
      setView('quote')
    }
  }, [reviewOpen, ready, hasQuote])

  const elapsed = formatElapsed(traceState.startedAt, traceState.endedAt, now)
  const ds: DisplayStatus = sent
    ? 'bound'
    : phase === 'ready'
      ? 'ready'
      : phase === 'failed'
        ? 'error'
        : phase === 'running'
          ? 'running'
          : 'pending'
  const name = cf?.request.summary || submissionLabel

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-[var(--color-border)] bg-white px-5 py-3">
        <nav className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
          <Link href="/dashboard" className="hover:text-[var(--color-text-secondary)]">Painel</Link>
          <span className="text-[var(--color-text-placeholder)]">›</span>
          <span className="font-medium text-[var(--color-text-primary)]">{name}</span>
        </nav>

        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#F1F3F6] p-1">
            <ToggleBtn active={view === 'flow'} onClick={() => setView('flow')}>Fluxo</ToggleBtn>
            <ToggleBtn active={view === 'quote'} disabled={!hasQuote} onClick={() => setView('quote')}>Orçamento</ToggleBtn>
          </div>

          <StatusChip status={ds} />

          <div className="hidden items-center gap-2 text-xs text-[var(--color-text-muted)] lg:flex">
            <Clock className="size-3.5 shrink-0 text-[var(--color-text-placeholder)]" />
            <span className="tabular font-semibold text-[var(--color-text-primary)]">{elapsed}</span>
            <span>vs {SITE_CONFIG.manualBaselineLabel}</span>
          </div>

          {view === 'flow' && ready && !replayMode && (
            <button onClick={() => setReplayMode(true)} className="btn-ghost whitespace-nowrap">
              <History className="size-3.5 shrink-0" /> Repetir
            </button>
          )}
          {sent && (
            <a href={`/api/runs/${runId}/quote-pdf`} download className="btn-secondary whitespace-nowrap">
              <Download className="size-4 shrink-0" /> PDF
            </a>
          )}
        </div>
      </header>

      {!replayMode && awaitOpen && <GateBanner node={liveState.nodes['await-customer']} variant="customer" />}
      {!replayMode && reviewOpen && <GateBanner node={liveState.nodes.review} variant="review" />}

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
                <DetailPanel nodeId={selected} node={traceState.nodes[selected]} onClose={() => setSelected(null)} />
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
                <RunReview runId={runId} caseFile={cf} reviewOpen={reviewOpen} onAction={fetchCase} />
              ) : (
                <div className="card flex items-center justify-center gap-2 px-6 py-16 text-sm text-[var(--color-text-muted)]">
                  <Loader2 className="size-4 animate-spin" /> A carregar…
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
