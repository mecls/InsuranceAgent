import type { RunEvent } from '@/lib/events/types'
import { NODES, type NodeId } from '@/lib/underwriting/nodes'

/**
 * Pure run state machine. Both live mode and Replay feed the same `RunEvent`
 * stream through `applyEvent`, so the dashboard renders identically from either
 * source. No transport concerns here — see `useRunStream` for the SSE side.
 */

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'streaming'
  | 'awaiting_human'
  | 'complete'
  | 'error'
  | 'skipped'

export interface NodeState {
  id: NodeId
  status: NodeStatus
  /** Current live sub-step line ("what's happening"). */
  activity?: string
  progress?: number
  /** Quality chip (confidence, appetite decision, premium…). */
  chip?: string
  /** Compact output summary surfaced in the detail panel. */
  summary?: string
  /** Structured outputs (node.output detail payloads) for the detail panel. */
  outputs: unknown[]
  enteredAt?: number
  completedAt?: number
  durationMs?: number
  error?: string
  /** Raw events for this node — the detail panel Activity tab. */
  events: RunEvent[]
}

export interface ActiveEdge {
  source: NodeId
  target: NodeId
  label: string
  /** seq at which the edge fired — used to fade it after a beat. */
  seq: number
}

export type RunPhase = 'idle' | 'running' | 'ready' | 'failed'

export interface RunState {
  phase: RunPhase
  nodes: Record<NodeId, NodeState>
  activeEdges: ActiveEdge[]
  startedAt?: number
  endedAt?: number
  lastSeq: number
  error?: string
}

export function initialRunState(): RunState {
  const nodes = {} as Record<NodeId, NodeState>
  for (const n of NODES) {
    nodes[n.id] = { id: n.id, status: 'pending', outputs: [], events: [] }
  }
  return { phase: 'idle', nodes, activeEdges: [], lastSeq: 0 }
}

function ts(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Date.now()
}

export function applyEvent(state: RunState, evt: RunEvent): RunState {
  if (evt.seq <= state.lastSeq) return state
  const next: RunState = {
    ...state,
    lastSeq: evt.seq,
    nodes: { ...state.nodes },
    activeEdges: state.activeEdges,
  }

  // Run-level events.
  if (evt.nodeId === 'run') {
    if (evt.type === 'run.started') {
      next.phase = 'running'
      next.startedAt = ts(evt.ts)
    } else if (evt.type === 'run.completed') {
      next.phase = 'ready'
      next.endedAt = ts(evt.ts)
    } else if (evt.type === 'run.failed') {
      next.phase = 'failed'
      next.endedAt = ts(evt.ts)
      next.error = evt.payload.error
    }
    return next
  }

  const nodeId = evt.nodeId
  const prev = state.nodes[nodeId]
  if (!prev) return next
  const node: NodeState = {
    ...prev,
    events: [...prev.events, evt],
  }

  switch (evt.type) {
    case 'node.entered':
      node.status = 'running'
      node.enteredAt = ts(evt.ts)
      node.activity = evt.payload.message
      break
    case 'node.activity':
      node.status = 'streaming'
      node.activity = evt.payload.message ?? node.activity
      node.progress = evt.payload.progress ?? node.progress
      break
    case 'node.tool_call.started':
      node.status = 'streaming'
      node.activity = `Using ${evt.payload.tool}…`
      break
    case 'node.tool_call.completed':
      node.activity = evt.payload.summary ?? node.activity
      break
    case 'node.output':
      if (evt.payload.summary) node.summary = evt.payload.summary
      if (evt.payload.detail !== undefined)
        node.outputs = [...node.outputs, evt.payload.detail]
      break
    case 'node.completed':
      node.status = 'complete'
      node.completedAt = ts(evt.ts)
      node.durationMs = node.enteredAt
        ? node.completedAt - node.enteredAt
        : undefined
      node.summary = evt.payload.summary ?? node.summary
      node.chip = evt.payload.chip ?? node.chip
      node.activity = undefined
      break
    case 'node.error':
      node.status = 'error'
      node.error = evt.payload.error
      node.activity = undefined
      break
    case 'node.awaiting_human':
      node.status = 'awaiting_human'
      node.activity = evt.payload.message
      break
    case 'edge.active':
      if (evt.payload.toNode) {
        next.activeEdges = [
          ...state.activeEdges.filter(
            (e) => !(e.source === nodeId && e.target === evt.payload.toNode),
          ),
          {
            source: nodeId,
            target: evt.payload.toNode,
            label: evt.payload.payloadLabel ?? '',
            seq: evt.seq,
          },
        ]
      }
      break
  }

  next.nodes[nodeId] = node
  return next
}

export function applyEvents(state: RunState, evts: RunEvent[]): RunState {
  return evts.reduce(applyEvent, state)
}
