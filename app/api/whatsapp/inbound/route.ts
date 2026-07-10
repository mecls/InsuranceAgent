import crypto from 'node:crypto'
import { type NextRequest } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { createRun, findOpenRunByCustomerContact, saveCaseFile } from '@/lib/db/runs'
import { emptyCaseFile } from '@/lib/procurement/case-file'
import { recordEmail } from '@/lib/services/email-sender'

export const runtime = 'nodejs'

/**
 * WhatsApp inbound (Meta Cloud API).
 *  - GET  = webhook verification (hub.verify_token → hub.challenge).
 *  - POST = incoming messages. A message from a phone with an in-flight case
 *    resolves the await-customer gate; otherwise it opens a new draft case.
 * The request body signature is verified with X-Hub-Signature-256.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? '', { status: 200 })
  }
  return new Response('forbidden', { status: 403 })
}

function verifySignature(raw: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return true // no secret configured (e.g. local POST testing)
  if (!signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

interface WaMessage {
  from: string
  text?: { body?: string }
  type?: string
}

export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text()
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('invalid signature', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const messages = extractMessages(body)
  for (const m of messages) {
    const from = m.from
    const text = m.text?.body ?? ''
    if (!from || !text) continue

    const open = await findOpenRunByCustomerContact(from)
    if (open) {
      await recordEmail({ runId: open.id, direction: 'inbound', supplierId: null, to: from, subject: 'WhatsApp', body: text })
      await inngest.send({ name: 'quote/customer-message', data: { runId: open.id, text } })
      continue
    }

    const { id, slug } = await createRun({ submissionLabel: text.slice(0, 80), scenario: 'whatsapp' })
    const caseFile = emptyCaseFile(slug)
    caseFile.customer = { channel: 'whatsapp', contact: from }
    caseFile.request = { summary: text.slice(0, 80), rawText: text, category: null }
    caseFile.source = { type: 'whatsapp' }
    await saveCaseFile(id, caseFile)
    await inngest.send({ name: 'quote/request-received', data: { runId: id } })
  }

  return Response.json({ ok: true })
}

function extractMessages(body: unknown): WaMessage[] {
  const out: WaMessage[] = []
  const b = body as { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] }
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type === undefined || msg.type === 'text') out.push(msg)
      }
    }
  }
  return out
}
