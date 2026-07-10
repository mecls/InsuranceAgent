import { type NextRequest } from 'next/server'
import { createSlackRun, postMessage, recordRunChannel, verifySlackSignature } from '@/lib/services/slack'

export const runtime = 'nodejs'

/**
 * Slash command `/orcamento <descrição | scenario | emails>`. Opens a case and
 * posts an anchor message into the channel; the orchestrator threads progress +
 * the comparison (with Approve buttons) under it.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text()
  const ts = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig = req.headers.get('x-slack-signature') ?? ''
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response('invalid signature', { status: 401 })
  }

  const params = new URLSearchParams(raw)
  const text = (params.get('text') ?? '').trim()
  const channel = params.get('channel_id') ?? ''

  const { runId, title } = await createSlackRun(text)
  const anchor = await postMessage(channel, `:page_facing_up: Caso aberto: *${title}*. Vou publicar o progresso aqui.`)
  await recordRunChannel(runId, channel, anchor.ts)

  return Response.json({ response_type: 'ephemeral', text: 'Caso aberto. Acompanhe o progresso neste canal.' })
}
