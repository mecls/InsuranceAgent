import { events } from '@/lib/events/emit'
import { customerLabel, type CaseFile } from '@/lib/procurement/case-file'

/**
 * Intake — receber o pedido. Deterministic: the request + customer were seeded by
 * the entry point (form, or a parsed WhatsApp/email draft), so intake confirms
 * the case and hands off to clarify.
 */
export async function runIntake(runId: string, caseFile: CaseFile): Promise<CaseFile> {
  await events.entered(runId, 'intake', 'A receber o pedido do cliente')

  const via =
    caseFile.customer.channel === 'whatsapp'
      ? 'WhatsApp'
      : caseFile.customer.channel === 'email'
        ? 'email'
        : 'formulário'
  await events.activity(runId, 'intake', `Pedido de ${customerLabel(caseFile)} via ${via}`, 0.4)
  await events.activity(runId, 'intake', caseFile.request.summary, 0.8)

  caseFile.status = 'recebido'
  await events.output(runId, 'intake', `Caso aberto — ${caseFile.request.summary}`, {
    customer: caseFile.customer,
    request: caseFile.request,
  })
  await events.completed(runId, 'intake', caseFile.request.category ?? 'Pedido recebido', via)
  return caseFile
}
