import type { NodeId } from '@/lib/underwriting/nodes'

/**
 * The event model is the backbone of the system. Every agent emits structured
 * events to the append-only `events` table; the SSE stream pushes them to the
 * dashboard; the same store powers Replay AND is read by the Compliance & Audit
 * agent to assemble the audit trail.
 */

export type EventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'node.entered'
  | 'node.activity'
  | 'node.tool_call.started'
  | 'node.tool_call.completed'
  | 'node.output'
  | 'node.completed'
  | 'node.error'
  | 'node.awaiting_human'
  | 'edge.active'

export interface EventPayload {
  /** Streaming sub-step text — drives the node's live "what's happening" line. */
  message?: string
  /** 0..1 progress for the node card's small indicator. */
  progress?: number
  /** A short quality chip value (e.g. "92% avg confidence", "REFER"). */
  chip?: string
  /** Tool name for tool_call events. */
  tool?: string
  /** For node.output / node.completed: a compact summary of what was produced. */
  summary?: string
  /** For edge.active: the destination node and a payload label. */
  toNode?: NodeId
  payloadLabel?: string
  /** For node.error / run.failed. */
  error?: string
  /** Arbitrary structured detail surfaced in the detail panel tabs. */
  detail?: unknown
}

export interface RunEvent {
  seq: number
  runId: string
  nodeId: NodeId | 'run'
  type: EventType
  ts: string
  payload: EventPayload
}

/** Row shape as stored in Postgres (snake_case). */
export interface EventRow {
  seq: number
  run_id: string
  node_id: string
  type: EventType
  ts: string
  payload: EventPayload
}

export function rowToEvent(row: EventRow): RunEvent {
  return {
    seq: Number(row.seq),
    runId: row.run_id,
    nodeId: row.node_id as RunEvent['nodeId'],
    type: row.type,
    ts: row.ts,
    payload: row.payload ?? {},
  }
}
