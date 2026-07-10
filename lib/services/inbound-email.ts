import { inngest } from '@/lib/inngest/client'
import { createRun, saveCaseFile } from '@/lib/db/runs'
import { emptyCaseFile } from '@/lib/procurement/case-file'
import { recordEmail } from '@/lib/services/email-sender'

/**
 * Inbound email ingestion. Two paths, keyed off the recipient address:
 *  - a plus-addressed reply (orcamentos+<runId>.cliente@domain) is the CUSTOMER
 *    answering a clarifying question; it resolves the await-customer gate.
 *  - a plain address (orcamentos@domain) opens a NEW draft case from the email
 *    (subject → resumo, body → pedido, sender → cliente), parsed by prepare-draft.
 */

export interface InboundEmail {
  to: string
  from?: string
  subject?: string
  text?: string
}

/** Parse orcamentos+<runId>[.cliente]@domain → runId. */
export function parsePlusRunId(to: string): string | null {
  const m = to.match(/orcamentos\+([^@]+)@/i)
  if (!m) return null
  const runId = m[1].split('.')[0]
  return runId || null
}

function emailAddress(from?: string): string | undefined {
  if (!from) return undefined
  const m = from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  return m ? m[0] : from
}

export async function ingestInboundEmail(
  email: InboundEmail,
): Promise<{ ok: boolean; kind: 'reply' | 'new-case' | 'ignored'; runId?: string }> {
  const to = email.to ?? ''
  const rawText = email.text ?? ''
  const subject = email.subject ?? ''

  // Path 1 — the customer's reply to a clarifying question.
  const runId = parsePlusRunId(to)
  if (runId) {
    await recordEmail({ runId, direction: 'inbound', supplierId: null, to, subject, body: rawText })
    await inngest.send({ name: 'quote/customer-message', data: { runId, text: rawText || subject } })
    return { ok: true, kind: 'reply', runId }
  }

  // Path 2 — open a new draft case from an email to the plain inbox.
  if (!rawText.trim() && !subject.trim()) return { ok: false, kind: 'ignored' }
  const { id, slug } = await createRun({ submissionLabel: subject || 'Pedido por email', scenario: 'email' })
  const caseFile = emptyCaseFile(slug)
  caseFile.demo = false
  caseFile.customer = { channel: 'email', contact: emailAddress(email.from) }
  caseFile.request = { summary: subject || rawText.slice(0, 80), rawText: rawText || subject, category: null }
  caseFile.source = { type: 'email' }
  await saveCaseFile(id, caseFile)
  await inngest.send({ name: 'quote/request-received', data: { runId: id } })
  return { ok: true, kind: 'new-case', runId: id }
}
