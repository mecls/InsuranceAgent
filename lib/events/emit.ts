import { supabaseService } from '@/lib/supabase/service'
import type { NodeId } from '@/lib/underwriting/nodes'
import {
  rowToEvent,
  type EventPayload,
  type EventRow,
  type EventType,
  type RunEvent,
} from './types'

/**
 * Append-only writer. `seq` is a global identity column on the table, so
 * ordering within a run is a monotonic subsequence with no per-run counter to
 * race on (parallel section calls can emit concurrently and still order
 * correctly). The assigned seq is read back for the caller / live stream.
 */
export async function emit(
  runId: string,
  nodeId: NodeId | 'run',
  type: EventType,
  payload: EventPayload = {},
): Promise<RunEvent> {
  const { data, error } = await supabaseService()
    .from('events')
    .insert({ run_id: runId, node_id: nodeId, type, payload })
    .select('seq, run_id, node_id, type, ts, payload')
    .single()
  if (error || !data) {
    throw new Error(`emit failed: ${error?.message ?? 'no data'}`)
  }
  return rowToEvent(data as EventRow)
}

/** Convenience helpers used by the orchestrator nodes. */
export const events = {
  runStarted: (runId: string, label: string) =>
    emit(runId, 'run', 'run.started', { summary: label }),
  runCompleted: (runId: string, summary: string) =>
    emit(runId, 'run', 'run.completed', { summary }),
  runFailed: (runId: string, error: string) =>
    emit(runId, 'run', 'run.failed', { error }),

  entered: (runId: string, nodeId: NodeId, message?: string) =>
    emit(runId, nodeId, 'node.entered', { message }),
  activity: (
    runId: string,
    nodeId: NodeId,
    message: string,
    progress?: number,
  ) => emit(runId, nodeId, 'node.activity', { message, progress }),
  toolStarted: (runId: string, nodeId: NodeId, tool: string) =>
    emit(runId, nodeId, 'node.tool_call.started', { tool }),
  toolCompleted: (runId: string, nodeId: NodeId, tool: string, summary?: string) =>
    emit(runId, nodeId, 'node.tool_call.completed', { tool, summary }),
  output: (runId: string, nodeId: NodeId, summary: string, detail?: unknown) =>
    emit(runId, nodeId, 'node.output', { summary, detail }),
  completed: (runId: string, nodeId: NodeId, summary?: string, chip?: string) =>
    emit(runId, nodeId, 'node.completed', { summary, chip }),
  error: (runId: string, nodeId: NodeId, error: string) =>
    emit(runId, nodeId, 'node.error', { error }),
  awaitingHuman: (runId: string, nodeId: NodeId, message: string) =>
    emit(runId, nodeId, 'node.awaiting_human', { message }),
  edgeActive: (
    runId: string,
    source: NodeId,
    target: NodeId,
    payloadLabel: string,
  ) => emit(runId, source, 'edge.active', { toNode: target, payloadLabel }),
}

/** Read events for a run, optionally only those after a given seq (for tailing). */
export async function readEvents(
  runId: string,
  afterSeq = 0,
): Promise<RunEvent[]> {
  const { data, error } = await supabaseService()
    .from('events')
    .select('seq, run_id, node_id, type, ts, payload')
    .eq('run_id', runId)
    .gt('seq', afterSeq)
    .order('seq', { ascending: true })
  if (error) throw new Error(`readEvents failed: ${error.message}`)
  return (data as EventRow[] | null)?.map(rowToEvent) ?? []
}
