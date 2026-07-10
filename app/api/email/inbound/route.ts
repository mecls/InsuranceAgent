import { type NextRequest } from 'next/server'
import { ingestInboundEmail, type InboundEmail } from '@/lib/services/inbound-email'
import { parseEml } from '@/lib/services/doc-parser'

export const runtime = 'nodejs'

/**
 * Inbound email webhook. Accepts a fornecedor's reply (plus-addressed) or a new
 * case request (plain inbox). Tolerant of shapes: Resend's inbound JSON, a raw
 * `.eml` upload, or a simple { to, from, subject, text } body — so the same
 * endpoint works with whatever mail relay is wired up.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let email: InboundEmail | null = null

  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('message/rfc822') || contentType.includes('text/plain')) {
      const buf = new Uint8Array(await req.arrayBuffer())
      const parsed = await parseEml(buf)
      email = {
        to: recipientFromEml(parsed) ?? '',
        from: parsed.from.address,
        subject: parsed.subject,
        text: parsed.text,
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>
      email = normalizeJson(body)
    }
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 400 })
  }

  if (!email || !email.to) {
    return Response.json({ ok: false, error: 'no recipient' }, { status: 400 })
  }

  const result = await ingestInboundEmail(email)
  return Response.json(result, { status: result.ok ? 200 : 202 })
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v) return v
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
    if (v && typeof v === 'object' && 'address' in v && typeof (v as { address: unknown }).address === 'string')
      return (v as { address: string }).address
  }
  return undefined
}

/** Map a Resend-style / generic inbound JSON payload to InboundEmail. */
function normalizeJson(body: Record<string, unknown>): InboundEmail {
  const data = (body.data as Record<string, unknown> | undefined) ?? body
  return {
    to: firstString(data.to, data.recipient, (data as { envelope?: { to?: unknown } }).envelope?.to) ?? '',
    from: firstString(data.from, data.sender),
    subject: firstString(data.subject) ?? '',
    text: firstString(data.text, data.plain, data.body, data.html) ?? '',
  }
}

function recipientFromEml(parsed: { text: string }): string | null {
  // parseEml does not expose the To header; the relay must pass the recipient
  // separately for the raw-eml path. Fall back to scanning the body.
  const m = parsed.text.match(/orcamentos\+[^@\s]+@[^\s>]+/i)
  return m ? m[0] : null
}
