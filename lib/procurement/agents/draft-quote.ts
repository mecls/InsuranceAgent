import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import { customerLabel, type CaseFile } from '@/lib/procurement/case-file'
import { QUOTE_DOC_TOOL_INPUT_SCHEMA, QuoteDocSchema } from '@/lib/procurement/schema'
import { euro } from '@/lib/procurement/pricing'

const DRAFT_SYSTEM = `# Esta chamada: REDIGIR O ORÇAMENTO

Redige o orçamento a enviar ao cliente, em Português de Portugal.

## Regras
- Saudação ao cliente, uma breve descrição do trabalho a realizar e os próximos passos.
- NÃO repitas nem recalcules a tabela de preços nem o total (são gerados por código e anexados). Podes referir o valor total qualitativamente.
- Propõe prazo de execução, validade do orçamento e condições de pagamento razoáveis.
- Tom profissional e cortês. Assina como "Equipa".`

/**
 * Draft-quote — redigir orçamento. Writes the customer-facing quote document
 * (intro, terms) around the deterministically-priced table.
 */
export async function runDraftQuote(runId: string, caseFile: CaseFile): Promise<CaseFile> {
  await events.entered(runId, 'draft-quote', 'A redigir o orçamento para o cliente')

  const lineText = caseFile.lineItems
    .map((l) => `- ${l.description}: ${l.quantity} ${l.unit} × ${euro(l.unitPrice)} = ${euro(l.total)}`)
    .join('\n')

  await events.toolStarted(runId, 'draft-quote', 'emit_quote_doc')
  const doc = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: DRAFT_SYSTEM }],
    userPrompt: `Cliente: ${customerLabel(caseFile)}
Pedido: ${caseFile.request.summary}

Linhas do orçamento (preços já calculados):
${lineText}
Subtotal: ${euro(caseFile.pricing?.subtotal)} | IVA: ${euro(caseFile.pricing?.ivaAmount)} | Total: ${euro(caseFile.pricing?.total)}

# Tarefa
Redige o orçamento. Chama \`emit_quote_doc\` exatamente uma vez.`,
    toolName: 'emit_quote_doc',
    toolDescription: 'Emite o orçamento (assunto, corpo, prazo, validade, condições, exclusões). Chama exatamente uma vez.',
    toolInputSchema: QUOTE_DOC_TOOL_INPUT_SCHEMA,
    schema: QuoteDocSchema,
    callLabel: 'draft-quote',
  })
  await events.toolCompleted(runId, 'draft-quote', 'emit_quote_doc')

  caseFile.quote = {
    subject: doc.subject,
    body: doc.body,
    prazoExecucao: doc.prazoExecucao,
    validade: doc.validade,
    condicoesPagamento: doc.condicoesPagamento,
    exclusoes: doc.exclusoes,
  }
  caseFile.status = 'redigido'

  await events.output(runId, 'draft-quote', 'Orçamento redigido', { quote: caseFile.quote })
  await events.completed(runId, 'draft-quote', doc.subject, 'redigido')
  return caseFile
}
