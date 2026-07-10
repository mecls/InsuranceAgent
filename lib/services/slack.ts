import crypto from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { createRun, saveCaseFile } from '@/lib/db/runs'
import { inngest } from '@/lib/inngest/client'
import { emptyCaseFile, type CaseFile } from '@/lib/procurement/case-file'
import { euro } from '@/lib/procurement/pricing'
import { getScenario, SCENARIO_KEYS } from '@/lib/demo/scenarios'

/**
 * Slack integration — an internal channel. `/orcamento <scenario>` opens a case
 * and the agent posts run progress + the drafted quote (with an Approve button)
 * back into the thread; the button fires the SAME `quote/human-approval` event as
 * the web button, so both surfaces resolve one review gate.
 */

export function slackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN
}

function signingSecret(): string {
  return process.env.SLACK_SIGNING_SECRET ?? ''
}

export function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = signingSecret()
  if (!secret || !timestamp || !signature) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 60 * 5) return false
  const base = `v0:${timestamp}:${rawBody}`
  const hmac = crypto.createHmac('sha256', secret).update(base).digest('hex')
  const expected = `v0=${hmac}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

type Block = Record<string, unknown>

async function callSlack(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; ts?: string }> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return { ok: false }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as { ok: boolean; ts?: string }
}

export async function postMessage(channel: string, text: string, blocks?: Block[]) {
  return callSlack('chat.postMessage', { channel, text, blocks })
}

export async function postThreadReply(channel: string, threadTs: string | undefined, text: string, blocks?: Block[]) {
  return callSlack('chat.postMessage', { channel, thread_ts: threadTs, text, blocks })
}

/** The drafted quote summary + Approve/Reject buttons. */
export function buildQuoteBlocks(cf: CaseFile, runId: string): Block[] {
  const lines = cf.lineItems.map((l) => `• ${l.description}: ${euro(l.total)}`).join('\n')
  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Orçamento pronto — ${cf.request.summary}*\n${lines}\n*Total: ${euro(cf.pricing?.total)} c/IVA*`,
      },
    },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Aprovar e enviar' }, action_id: 'approve', value: JSON.stringify({ runId }), style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: 'Não enviar' }, action_id: 'reject', value: JSON.stringify({ runId }), style: 'danger' },
      ],
    },
  ]
  return blocks
}

// ── run_channels ─────────────────────────────────────────────────────────────

export async function recordRunChannel(runId: string, channel: string, threadTs?: string): Promise<void> {
  const { error } = await supabaseService()
    .from('run_channels')
    .insert({ run_id: runId, kind: 'slack', channel, thread_ts: threadTs ?? null })
  if (error) throw new Error(`recordRunChannel failed: ${error.message}`)
}

export async function getRunChannel(runId: string): Promise<{ channel: string; threadTs?: string } | null> {
  const { data, error } = await supabaseService()
    .from('run_channels')
    .select('channel, thread_ts')
    .eq('run_id', runId)
    .eq('kind', 'slack')
    .maybeSingle()
  if (error) throw new Error(`getRunChannel failed: ${error.message}`)
  if (!data) return null
  return { channel: data.channel as string, threadTs: (data.thread_ts as string | null) ?? undefined }
}

export async function postRunUpdate(runId: string, text: string, blocks?: Block[]): Promise<void> {
  if (!slackConfigured()) return
  const ch = await getRunChannel(runId)
  if (!ch) return
  await postThreadReply(ch.channel, ch.threadTs, text, blocks)
}

/**
 * Open a quoting case from Slack text. Picks a demo scenario from the text
 * (default "fachada") so the whole flow plays back into the channel. Seeds the
 * Case File (source = slack) and enqueues the orchestrator.
 */
export async function createSlackRun(text: string): Promise<{ runId: string; slug: string; title: string }> {
  const key = SCENARIO_KEYS.find((k) => text.toLowerCase().includes(k)) ?? 'fachada'
  const scenario = getScenario(key)!
  const { id, slug } = await createRun({ submissionLabel: scenario.request.summary, scenario: scenario.id })
  const caseFile = emptyCaseFile(slug)
  caseFile.demo = true
  caseFile.vertical = scenario.vertical
  caseFile.customer = { ...scenario.customer }
  caseFile.request = { ...scenario.request }
  caseFile.status = 'recebido'
  caseFile.source = { type: 'slack' }
  await saveCaseFile(id, caseFile)
  await inngest.send({ name: 'quote/run-requested', data: { runId: id } })
  return { runId: id, slug, title: scenario.request.summary }
}
