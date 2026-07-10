import { type NextRequest } from 'next/server'
import { createSlackRun, postMessage, recordRunChannel, verifySlackSignature } from '@/lib/services/slack'

export const runtime = 'nodejs'

/**
 * Slack Events API. Answers the url_verification challenge and opens a case from
 * an @mention of the bot (`@Orçamentos remodelação do escritório` or a scenario /
 * emails), posting the anchor message into the same channel.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text()

  // url_verification handshake is sent before the app is verified; answer it
  // without signature checking (there is no case to act on).
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return new Response('bad json', { status: 400 })
  }
  if (body.type === 'url_verification') {
    return Response.json({ challenge: body.challenge })
  }

  const ts = req.headers.get('x-slack-request-timestamp') ?? ''
  const sig = req.headers.get('x-slack-signature') ?? ''
  if (!verifySlackSignature(raw, ts, sig)) {
    return new Response('invalid signature', { status: 401 })
  }

  const event = body.event as
    | { type?: string; text?: string; channel?: string; bot_id?: string }
    | undefined
  if (event && (event.type === 'app_mention' || event.type === 'message') && !event.bot_id && event.channel) {
    const text = (event.text ?? '').replace(/<@[^>]+>/g, '').trim()
    if (text) {
      const { runId, title } = await createSlackRun(text)
      const anchor = await postMessage(
        event.channel,
        `:page_facing_up: Caso aberto: *${title}*. Vou publicar o progresso aqui.`,
      )
      await recordRunChannel(runId, event.channel, anchor.ts)
    }
  }

  // Ack fast so Slack does not retry.
  return Response.json({ ok: true })
}
