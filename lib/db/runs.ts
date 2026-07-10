import { nanoid } from 'nanoid'
import { supabaseService } from '@/lib/supabase/service'
import type { CaseFile } from '@/lib/procurement/case-file'

export type RunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_human'
  | 'ready'
  | 'failed'

export interface RunRow {
  id: string
  slug: string
  status: RunStatus
  submission_label: string
  /** The scenario id for a demo run (obra | escritorio | seguro | …), or the
   *  entry channel for a live run (web | gmail | slack). */
  scenario: string
  case_file: CaseFile | null
  error_message: string | null
  created_at: string
  ready_at: string | null
}

const BUCKET = 'submissions'

export async function createRun(args: {
  submissionLabel: string
  scenario: string
}): Promise<{ id: string; slug: string }> {
  const slug = nanoid(10)
  const { data, error } = await supabaseService()
    .from('runs')
    .insert({
      slug,
      status: 'pending',
      submission_label: args.submissionLabel,
      scenario: args.scenario,
    })
    .select('id, slug')
    .single()
  if (error || !data) {
    throw new Error(`createRun failed: ${error?.message ?? 'no data'}`)
  }
  return { id: data.id as string, slug: data.slug as string }
}

export async function getRunById(id: string): Promise<RunRow | null> {
  const { data, error } = await supabaseService()
    .from('runs')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getRunById failed: ${error.message}`)
  return (data as RunRow | null) ?? null
}

export async function getRunBySlug(slug: string): Promise<RunRow | null> {
  const { data, error } = await supabaseService()
    .from('runs')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`getRunBySlug failed: ${error.message}`)
  return (data as RunRow | null) ?? null
}

export async function listRuns(limit = 30): Promise<RunRow[]> {
  const { data, error } = await supabaseService()
    .from('runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listRuns failed: ${error.message}`)
  return (data as RunRow[] | null) ?? []
}

/**
 * Find the most recent in-flight run whose customer contact matches (phone or
 * email) — used to route an inbound WhatsApp/email reply back to its case.
 */
export async function findOpenRunByCustomerContact(contact: string): Promise<RunRow | null> {
  const { data, error } = await supabaseService()
    .from('runs')
    .select('*')
    .in('status', ['running', 'awaiting_human'])
    .eq('case_file->customer->>contact', contact)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findOpenRunByCustomerContact failed: ${error.message}`)
  return (data as RunRow | null) ?? null
}

export async function setRunStatus(
  id: string,
  status: RunStatus,
): Promise<void> {
  const { error } = await supabaseService()
    .from('runs')
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(`setRunStatus failed: ${error.message}`)
}

/** Persist the (partial) Case File. Called after each node writes its slice. */
export async function saveCaseFile(
  id: string,
  caseFile: CaseFile,
): Promise<void> {
  const { error } = await supabaseService()
    .from('runs')
    .update({ case_file: caseFile })
    .eq('id', id)
  if (error) throw new Error(`saveCaseFile failed: ${error.message}`)
}

export async function markRunReady(
  id: string,
  caseFile: CaseFile,
): Promise<void> {
  const { error } = await supabaseService()
    .from('runs')
    .update({
      status: 'ready',
      case_file: caseFile,
      ready_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(`markRunReady failed: ${error.message}`)
}

export async function markRunFailed(id: string, message: string): Promise<void> {
  const { error } = await supabaseService()
    .from('runs')
    .update({ status: 'failed', error_message: message.slice(0, 2000) })
    .eq('id', id)
  if (error) throw new Error(`markRunFailed failed: ${error.message}`)
}

export type HumanActionType =
  | 'send_rfq'
  | 'chase'
  | 'proceed'
  | 'adjudicate'
  | 'reject_quote'
  | 'skip_supplier'
  | 'override_field'

export async function recordHumanAction(
  runId: string,
  type: HumanActionType,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseService()
    .from('human_actions')
    .insert({ run_id: runId, type, payload })
  if (error) throw new Error(`recordHumanAction failed: ${error.message}`)
}

// ── Storage (submission attachments) ────────────────────────────────────────

export async function uploadAttachment(args: {
  runSlug: string
  filename: string
  bytes: ArrayBuffer | Uint8Array
  contentType: string
}): Promise<string> {
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  const storagePath = `${args.runSlug}/${safeName}`
  const { error } = await supabaseService()
    .storage.from(BUCKET)
    .upload(storagePath, args.bytes, {
      contentType: args.contentType,
      upsert: true,
    })
  if (error) throw new Error(`uploadAttachment failed: ${error.message}`)
  return storagePath
}

export async function downloadAttachment(
  storagePath: string,
): Promise<ArrayBuffer> {
  const { data, error } = await supabaseService()
    .storage.from(BUCKET)
    .download(storagePath)
  if (error || !data) {
    throw new Error(`downloadAttachment failed: ${error?.message ?? 'no data'}`)
  }
  return await data.arrayBuffer()
}
