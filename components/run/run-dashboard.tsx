'use client'

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Activity, CheckCircle2, XCircle, Clock, FileCheck, History } from 'lucide-react'
import { useRunStream } from './use-run-stream'
import { RunGraph } from '@/components/graph/run-graph'
import { DetailPanel } from '@/components/graph/detail-panel'
import { ReviewPanel } from './review-panel'
import { GapApprovalBanner } from './gap-approval-banner'
import { ReplayBar } from './replay-bar'
import { useReplay } from './use-replay'
import { type NodeId } from '@/lib/underwriting/nodes'
import { formatElapsed } from '@/lib/format'
import { SITE_CONFIG } from '@/lib/site-config'
import { cn } from '@/lib/utils'

interface RunDashboardProps {
  runId: string
  slug: string
  submissionLabel: string
}

export function RunDashboard({ runId, submissionLabel }: RunDashboardProps) {
  const { state: liveState, connected } = useRunStream(runId)
  const [replayMode, setReplayMode] = useState(false)
  const replay = useReplay(runId, replayMode)
  const state = replayMode ? replay.state : liveState
  const [selected, setSelected] = useState<NodeId | null>(null)
  // Derive review visibility from phase + explicit toggles (no setState-in-effect).
  // The surface auto-opens when the run is ready unless the user dismissed it.
  const [reviewOpened, setReviewOpened] = useState(false)
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Tick the elapsed clock while the run is live.
  useEffect(() => {
    if (state.phase !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [state.phase])

  const ready = liveState.phase === 'ready'
  const showReview =
    !replayMode && (reviewOpened || (ready && !reviewDismissed))
  const openReview = () => {
    setReviewOpened(true)
    setReviewDismissed(false)
  }
  const closeReview = () => {
    setReviewOpened(false)
    setReviewDismissed(true)
  }

  const elapsed = formatElapsed(state.startedAt, state.endedAt, now)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        submissionLabel={submissionLabel}
        phase={state.phase}
        elapsed={elapsed}
        connected={connected}
        canReview={ready && !replayMode}
        onReview={openReview}
        canReplay={ready && !replayMode}
        onReplay={() => setReplayMode(true)}
      />
      {!replayMode && state.nodes.gap.status === 'awaiting_human' && (
        <GapApprovalBanner runId={runId} gap={state.nodes.gap} />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlowProvider>
            <RunGraph state={state} selected={selected} onSelect={setSelected} />
          </ReactFlowProvider>
        </div>
        {selected && (
          <DetailPanel
            nodeId={selected}
            node={state.nodes[selected]}
            onClose={() => setSelected(null)}
          />
        )}
        {showReview && <ReviewPanel runId={runId} onClose={closeReview} />}
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
  )
}

function Header({
  submissionLabel,
  phase,
  elapsed,
  connected,
  canReview,
  onReview,
  canReplay,
  onReplay,
}: {
  submissionLabel: string
  phase: string
  elapsed: string
  connected: boolean
  canReview: boolean
  onReview: () => void
  canReplay: boolean
  onReplay: () => void
}) {
  const phaseChip =
    phase === 'ready' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="size-3.5" /> Quote ready
      </span>
    ) : phase === 'failed' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
        <XCircle className="size-3.5" /> Failed
      </span>
    ) : phase === 'running' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(27_45_190/0.08)] px-2.5 py-1 text-xs font-medium text-[var(--brand-accent)]">
        <Activity className="size-3.5 animate-pulse" /> Running
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
        Idle
      </span>
    )

  return (
    <header className="flex items-center justify-between gap-4 border-b border-black/10 bg-white px-5 py-3">
      <div className="min-w-0">
        <div className="eyebrow">{SITE_CONFIG.lineOfBusinessLabel}</div>
        <h1 className="truncate text-base font-semibold">{submissionLabel}</h1>
      </div>
      <div className="flex items-center gap-3">
        {/* Cycle-time banner — the money shot. */}
        <div className="hidden items-center gap-1.5 rounded-lg border border-black/10 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-600 sm:flex">
          <Clock className="size-3.5 text-neutral-400" />
          <span className="tabular font-semibold text-neutral-900">{elapsed}</span>
          <span className="text-neutral-400">vs {SITE_CONFIG.manualBaselineLabel}</span>
        </div>
        {phaseChip}
        {canReplay && (
          <button
            onClick={onReplay}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <History className="size-3.5" /> Replay
          </button>
        )}
        {canReview && (
          <button
            onClick={onReview}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-accent)] px-3 py-1.5 text-xs font-semibold text-white cta-shadow"
          >
            <FileCheck className="size-3.5" /> Review &amp; bind
          </button>
        )}
        <span
          className={cn(
            'size-2 rounded-full',
            connected ? 'bg-green-500' : 'bg-neutral-300',
          )}
          title={connected ? 'Live' : 'Disconnected'}
        />
      </div>
    </header>
  )
}
