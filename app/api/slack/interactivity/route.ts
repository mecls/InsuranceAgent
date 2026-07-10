import { type NextRequest } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { verifySlackSignature } from '@/lib/services/slack'

export const runtime = 'nodejs'

/**
 * Block Kit interactivity. The Approve / Reject buttons fire the SAME
 * `quote/human-approval` event the web button does, so both surfaces resolve one
 * review gate.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text()
  const ts = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig = req.headers.get('x-slack-signature') ?? ''
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response('invalid signature', { status: 401 })
  }

  const params = new URLSearchParams(raw)
  const payloadRaw = params.get('payload')
  if (!payloadRaw) return new Response('no payload', { status: 400 })

  const payload = JSON.parse(payloadRaw) as {
    actions?: { action_id: string; value: string }[]
  }
  const action = payload.actions?.[0]
  if (!action) return new Response('no action', { status: 400 })

  let value: { runId?: string } = {}
  try {
    value = JSON.parse(action.value)
  } catch {
    return new Response('bad value', { status: 400 })
  }
  if (!value.runId) return new Response('no runId', { status: 400 })

  const approved = action.action_id.startsWith('approve')
  await inngest.send({
    name: 'quote/human-approval',
    data: { runId: value.runId, approved },
  })

  const text = approved
    ? ':white_check_mark: Aprovado. A enviar o orçamento ao cliente.'
    : ':x: Orçamento não enviado.'
  return Response.json({ replace_original: false, text })
}
