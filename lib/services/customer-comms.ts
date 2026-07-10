import type { CaseFile } from '@/lib/procurement/case-file'
import { recordEmail, replyToFor } from '@/lib/services/email-sender'
import { Resend } from 'resend'

/**
 * Customer communications. Routes an outbound message to the customer on the
 * channel they used (email via Resend, WhatsApp via the Cloud API — Phase D).
 * Every message is recorded in the case mail log. Demo runs (and runs without
 * credentials) record only; the orchestrator does not branch on transport.
 */

let resend: Resend | null = null
function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!resend) resend = new Resend(key)
  return resend
}

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return false
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.slice(0, 4096) },
    }),
  })
  return res.ok
}

export async function sendToCustomer(args: {
  runId: string
  caseFile: CaseFile
  subject: string
  text: string
}): Promise<void> {
  const { runId, caseFile, subject, text } = args
  const { channel, contact } = caseFile.customer
  const to = contact ?? channel

  if (!caseFile.demo) {
    if (channel === 'whatsapp' && contact) {
      await sendWhatsApp(contact, `${subject}\n\n${text}`)
    } else if (channel === 'email' && contact) {
      const c = resendClient()
      if (c) {
        await c.emails.send({
          from: process.env.RFQ_FROM_EMAIL ?? process.env.AUDIT_FROM_EMAIL ?? 'orcamentos@example.com',
          to: contact,
          replyTo: replyToFor(runId, 'cliente'),
          subject,
          text,
        })
      }
    }
  }

  await recordEmail({ runId, direction: 'outbound', supplierId: null, to, subject, body: text })
}
