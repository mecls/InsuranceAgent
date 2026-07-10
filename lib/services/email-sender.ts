import { Resend } from 'resend'
import { supabaseService } from '@/lib/supabase/service'

/**
 * EmailSender. Every outbound message (RFQ, chase reminder, adjudication letter)
 * is recorded in `email_messages` — the case's mail log — and, when not a demo
 * run and a Resend key is configured, actually sent to the fornecedor.
 *
 * The Reply-To carries a plus-addressed token (orcamentos+<runId>.<supplierId>@…)
 * so an inbound reply webhook can correlate the fornecedor's answer back to the
 * exact case + supplier (see lib/services/inbound-email.ts).
 */

let resend: Resend | null = null
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!resend) resend = new Resend(key)
  return resend
}

function fromAddress(): string {
  return process.env.RFQ_FROM_EMAIL ?? process.env.AUDIT_FROM_EMAIL ?? 'orcamentos@example.com'
}

function inboundDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN ?? 'example.com'
}

/** Plus-addressed Reply-To that encodes the run + supplier for reply correlation. */
export function replyToFor(runId: string, supplierId: string): string {
  return `orcamentos+${runId}.${supplierId}@${inboundDomain()}`
}

export async function recordEmail(args: {
  runId: string
  direction: 'outbound' | 'inbound'
  supplierId?: string | null
  to: string
  subject: string
  body: string
  threadId?: string | null
}): Promise<void> {
  const { error } = await supabaseService()
    .from('email_messages')
    .insert({
      run_id: args.runId,
      direction: args.direction,
      supplier_id: args.supplierId ?? null,
      to_address: args.to,
      subject: args.subject,
      body: args.body,
      thread_id: args.threadId ?? null,
    })
  if (error) throw new Error(`recordEmail failed: ${error.message}`)
}

/**
 * Send an email to a fornecedor. Demo runs (and runs without a Resend key) only
 * record to the outbox; real runs also send via Resend. Same interface either
 * way, so the orchestrator does not branch on transport.
 */
export async function sendEmail(args: {
  runId: string
  supplierId: string
  to: string
  subject: string
  body: string
  demo: boolean
}): Promise<void> {
  const c = client()
  if (!args.demo && c) {
    await c.emails.send({
      from: fromAddress(),
      to: args.to,
      replyTo: replyToFor(args.runId, args.supplierId),
      subject: args.subject,
      text: args.body,
    })
  }
  await recordEmail({
    runId: args.runId,
    direction: 'outbound',
    supplierId: args.supplierId,
    to: args.to,
    subject: args.subject,
    body: args.body,
  })
}
