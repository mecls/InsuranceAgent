'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { nodeDef, type NodeId } from '@/lib/underwriting/nodes'
import type { NodeState } from '@/lib/run-state'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

type Tab = 'activity' | 'output' | 'errors'

interface DetailPanelProps {
  nodeId: NodeId
  node: NodeState
  onClose: () => void
}

export function DetailPanel({ nodeId, node, onClose }: DetailPanelProps) {
  const [tab, setTab] = useState<Tab>('activity')
  const def = nodeDef(nodeId)

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'activity', label: 'Activity', count: node.events.length },
    { id: 'output', label: 'Output', count: node.outputs.length || undefined },
    { id: 'errors', label: 'Errors', count: node.error ? 1 : undefined },
  ]

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-black/10 bg-white">
      <header className="flex items-start justify-between gap-2 border-b border-black/5 p-4">
        <div>
          <div className="text-sm font-semibold">{def.label}</div>
          <p className="mt-0.5 text-xs text-neutral-500">{def.blurb}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5">
              {node.status}
            </span>
            {node.durationMs !== undefined && (
              <span className="tabular">{formatDuration(node.durationMs)}</span>
            )}
            {node.chip && (
              <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 font-medium text-white tabular">
                {node.chip}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </header>

      <nav className="flex gap-1 border-b border-black/5 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-t-md px-3 py-1.5 text-xs font-medium',
              tab === t.id
                ? 'bg-neutral-100 text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-800',
            )}
          >
            {t.label}
            {t.count ? (
              <span className="ml-1 text-neutral-400 tabular">{t.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'activity' && <ActivityTab node={node} />}
        {tab === 'output' && <OutputTab node={node} />}
        {tab === 'errors' && <ErrorsTab node={node} />}
      </div>
    </aside>
  )
}

function ActivityTab({ node }: { node: NodeState }) {
  if (node.events.length === 0) {
    return <Empty>No activity yet.</Empty>
  }
  return (
    <ol className="space-y-2.5">
      {node.events.map((e, i) => (
        <li key={i} className="flex gap-2.5 text-xs">
          <span className="mt-0.5 tabular text-neutral-400">
            {new Date(e.ts).toLocaleTimeString([], {
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          <div>
            <span className="font-medium text-neutral-700">
              {e.type.replace('node.', '')}
            </span>
            {e.payload.message && (
              <span className="text-neutral-600"> — {e.payload.message}</span>
            )}
            {e.payload.tool && (
              <span className="text-[var(--brand-accent)]"> {e.payload.tool}</span>
            )}
            {e.payload.summary && (
              <span className="text-neutral-500"> {e.payload.summary}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

function OutputTab({ node }: { node: NodeState }) {
  if (node.outputs.length === 0 && !node.summary) {
    return <Empty>No output produced yet.</Empty>
  }
  return (
    <div className="space-y-3">
      {node.summary && (
        <p className="text-sm text-neutral-700">{node.summary}</p>
      )}
      {node.outputs.map((o, i) => (
        <pre
          key={i}
          className="overflow-auto rounded-lg bg-neutral-50 p-3 text-[11px] leading-relaxed text-neutral-700"
        >
          {JSON.stringify(o, null, 2)}
        </pre>
      ))}
    </div>
  )
}

function ErrorsTab({ node }: { node: NodeState }) {
  if (!node.error) return <Empty>No errors.</Empty>
  return (
    <pre className="overflow-auto rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
      {node.error}
    </pre>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-neutral-400">{children}</p>
}
