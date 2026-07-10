import { events } from '@/lib/events/emit'
import { customerLabel, type CaseFile } from '@/lib/procurement/case-file'
import { euro } from '@/lib/procurement/pricing'
import { sendToCustomer } from '@/lib/services/customer-comms'

/**
 * Send — enviar ao cliente. Delivers the orçamento (quote text + priced table) on
 * the customer's channel and records it on the case. In demo mode this only
 * writes to the mail log.
 */
export async function runSendQuote(runId: string, caseFile: CaseFile, nowIso: string): Promise<CaseFile> {
  await events.entered(runId, 'send', 'A enviar o orçamento ao cliente')

  const q = caseFile.quote
  const table = caseFile.lineItems
    .map((l) => `• ${l.description}: ${l.quantity} ${l.unit} x ${euro(l.unitPrice)} = ${euro(l.total)}`)
    .join('\n')
  const text = `${q?.body ?? ''}

${table}
Subtotal: ${euro(caseFile.pricing?.subtotal)}
IVA: ${euro(caseFile.pricing?.ivaAmount)}
Total: ${euro(caseFile.pricing?.total)} (c/IVA)${q?.prazoExecucao ? `\nPrazo: ${q.prazoExecucao}` : ''}${q?.validade ? `\nValidade: ${q.validade}` : ''}${q?.condicoesPagamento ? `\nPagamento: ${q.condicoesPagamento}` : ''}`

  await sendToCustomer({ runId, caseFile, subject: q?.subject ?? 'Orçamento', text })

  caseFile.sent = { at: nowIso, via: caseFile.customer.channel }
  caseFile.decision = 'pendente'
  caseFile.status = 'enviado'

  await events.output(runId, 'send', `Orçamento enviado a ${customerLabel(caseFile)}`, { sent: caseFile.sent })
  await events.completed(runId, 'send', `Enviado via ${caseFile.customer.channel}`, 'enviado')
  return caseFile
}
