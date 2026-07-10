import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/procurement/case-file'
import { LINE_ITEMS_TOOL_INPUT_SCHEMA, LineItemsSchema } from '@/lib/procurement/schema'
import { listCatalogItems } from '@/lib/db/catalog'
import { euro, priceLineItems } from '@/lib/procurement/pricing'

const PRICE_SYSTEM = `# Esta chamada: SELECIONAR ITENS DO CATÁLOGO

Com base no pedido esclarecido, monta as linhas do orçamento escolhendo os itens do catálogo da empresa e as quantidades.

## Regras
- Usa APENAS itens do catálogo fornecido. Para cada linha indica o catalogItemId exato e a quantidade (m2, unidades, horas, etc.) a partir da informação esclarecida.
- Se nenhum item do catálogo servir para algo pedido, cria a linha com catalogItemId=null e descreve-a (fica marcada para revisão; sem preço).
- NÃO calcules preços nem totais. Apenas escolhes item e quantidade; os valores são calculados por código.
- Se a quantidade não for conhecida ao certo, usa a melhor estimativa da informação disponível e regista o pressuposto em notes.`

/**
 * Price — calcular preços. The LLM selects catálogo items + quantities from the
 * clarified request; pricing.ts then computes every euro (line totals, per-rate
 * IVA, grand total) deterministically.
 */
export async function runPrice(runId: string, caseFile: CaseFile): Promise<CaseFile> {
  await events.entered(runId, 'price', 'A montar o orçamento a partir do catálogo')

  const catalog = await listCatalogItems()
  const catalogText = catalog
    .map((c) => `- ${c.id} | ${c.category} | ${c.description} | unidade: ${c.unit} | ${c.unitPrice}€/${c.unit} | IVA ${c.ivaRate}%`)
    .join('\n')
  const clarText = caseFile.clarifications
    .map((c) => `P: ${c.question}\nR: ${c.answer ?? '(sem resposta)'}`)
    .join('\n')

  await events.activity(runId, 'price', `A consultar ${catalog.length} itens do catálogo`, 0.3)
  await events.toolStarted(runId, 'price', 'emit_line_items')
  const result = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: PRICE_SYSTEM }],
    userPrompt: `Pedido: ${caseFile.request.summary}${caseFile.request.category ? `\nCategoria: ${caseFile.request.category}` : ''}
${clarText ? `\nEsclarecimentos:\n${clarText}` : ''}

Catálogo disponível:
${catalogText}

# Tarefa
Escolhe os itens do catálogo e as quantidades para este orçamento. Chama \`emit_line_items\` exatamente uma vez.`,
    toolName: 'emit_line_items',
    toolDescription: 'Emite as linhas do orçamento (item do catálogo + quantidade). Chama exatamente uma vez.',
    toolInputSchema: LINE_ITEMS_TOOL_INPUT_SCHEMA,
    schema: LineItemsSchema,
    callLabel: 'price',
  })
  await events.toolCompleted(runId, 'price', 'emit_line_items')

  const { lineItems, pricing } = priceLineItems(result.lineItems, catalog)
  caseFile.lineItems = lineItems
  caseFile.pricing = pricing
  caseFile.status = 'a_orcamentar'

  for (const l of lineItems) {
    await events.activity(
      runId,
      'price',
      `${l.description}: ${l.quantity} ${l.unit} × ${euro(l.unitPrice)} = ${euro(l.total)}`,
      0.8,
    )
  }

  await events.output(runId, 'price', `Total: ${euro(pricing.total)} (c/IVA)`, { lineItems, pricing, notes: result.notes })
  await events.completed(runId, 'price', `${euro(pricing.total)} c/IVA`, euro(pricing.total))
  return caseFile
}
