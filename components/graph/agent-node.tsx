'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Inbox,
  MessageCircleQuestion,
  Clock,
  Calculator,
  FileText,
  UserCheck,
  Send,
  Loader2,
  Check,
  TriangleAlert,
  CircleDashed,
  Hand,
} from 'lucide-react'
import type { NodeId } from '@/lib/procurement/nodes'
import type { NodeState, NodeStatus } from '@/lib/run-state'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICONS: Record<NodeId, React.ComponentType<{ className?: string }>> = {
  intake: Inbox,
  clarify: MessageCircleQuestion,
  'await-customer': Clock,
  price: Calculator,
  'draft-quote': FileText,
  review: UserCheck,
  send: Send,
}

const STATUS_RING: Record<NodeStatus, string> = {
  pending: 'border-black/10',
  running: 'border-[var(--brand-accent)] node-running',
  streaming: 'border-[var(--brand-accent)] node-running',
  awaiting_human: 'border-amber-500',
  complete: 'border-green-600/60',
  error: 'border-rose-600',
  skipped: 'border-black/5 opacity-50',
}

export interface AgentNodeData {
  nodeId: NodeId
  label: string
  mode: 'real' | 'sim' | 'gated'
  node: NodeState
  selected?: boolean
  [key: string]: unknown
}

function StatusBadge({ status }: { status: NodeStatus }) {
  const map: Record<NodeStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    pending: {
      icon: <CircleDashed className="size-3" />,
      text: 'Pending',
      cls: 'text-neutral-500 bg-neutral-100',
    },
    running: {
      icon: <Loader2 className="size-3 animate-spin" />,
      text: 'Running',
      cls: 'text-[var(--brand-accent)] bg-[rgb(27_45_190/0.08)]',
    },
    streaming: {
      icon: <Loader2 className="size-3 animate-spin" />,
      text: 'Working',
      cls: 'text-[var(--brand-accent)] bg-[rgb(27_45_190/0.08)]',
    },
    awaiting_human: {
      icon: <Hand className="size-3" />,
      text: 'Needs review',
      cls: 'text-amber-700 bg-amber-100',
    },
    complete: {
      icon: <Check className="size-3" />,
      text: 'Complete',
      cls: 'text-green-700 bg-green-100',
    },
    error: {
      icon: <TriangleAlert className="size-3" />,
      text: 'Error',
      cls: 'text-rose-700 bg-rose-100',
    },
    skipped: {
      icon: <CircleDashed className="size-3" />,
      text: 'Skipped',
      cls: 'text-neutral-400 bg-neutral-100',
    },
  }
  const s = map[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        s.cls,
      )}
    >
      {s.icon}
      {s.text}
    </span>
  )
}

export function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData
  const Icon = ICONS[d.nodeId]
  const { node } = d
  const showProgress =
    (node.status === 'running' || node.status === 'streaming') &&
    typeof node.progress === 'number'

  return (
    <div
      className={cn(
        'w-64 rounded-2xl border-2 bg-white p-3.5 shadow-sm transition-colors',
        STATUS_RING[node.status],
        d.selected && 'ring-2 ring-[var(--brand-accent)] ring-offset-2',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-neutral-300" />
      <Handle type="source" position={Position.Right} className="!bg-neutral-300" />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-neutral-100 text-neutral-700">
            <Icon className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold leading-tight">{d.label}</div>
            {d.mode !== 'real' && (
              <div className="text-[10px] uppercase tracking-wide text-amber-600">
                {d.mode === 'sim' ? 'simulated' : 'gated'}
              </div>
            )}
          </div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      {/* Live activity line — "what's happening". */}
      <div className="mt-2.5 min-h-[18px] text-xs text-neutral-600">
        {node.activity ? (
          <span className="line-clamp-1">{node.activity}</span>
        ) : node.summary && node.status === 'complete' ? (
          <span className="line-clamp-1 text-neutral-500">{node.summary}</span>
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </div>

      {showProgress && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-[var(--brand-accent)] transition-all"
            style={{ width: `${Math.round((node.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-neutral-500">
        <span className="tabular">
          {node.status === 'complete'
            ? formatDuration(node.durationMs)
            : node.status === 'pending'
              ? 'idle'
              : 'live'}
        </span>
        {node.chip && (
          <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 font-medium text-white tabular">
            {node.chip}
          </span>
        )}
      </div>
    </div>
  )
}
