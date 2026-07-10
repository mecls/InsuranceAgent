import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/procurement/case-file'
import { CLARIFY_TOOL_INPUT_SCHEMA, ClarifySchema } from '@/lib/procurement/schema'

const CLARIFY_SYSTEM = `# Esta chamada: ESCLARECER O PEDIDO

Analisa o pedido do cliente e determina se tens informação suficiente para orçamentar. Para orçamentar um serviço tipicamente precisas de: âmbito exato, quantidade/área (ex.: m2), materiais/acabamentos, morada/acesso e prazo pretendido.

## Regras
- Se já houver informação suficiente para orçamentar, devolve ready=true e listas vazias.
- Caso contrário, ready=false, lista a informação em falta (needed) e escreve as perguntas concretas a enviar ao cliente (questions), curtas e claras, em Português de Portugal.
- Pergunta apenas o essencial para conseguir orçamentar. Não peças dados irrelevantes.`

/**
 * Clarify — esclarecer. Detects what's missing to price the job and drafts the
 * questions to send the customer. If the request is already complete, marks ready
 * so the await-customer node passes straight through.
 */
export async function runClarify(runId: string, caseFile: CaseFile): Promise<CaseFile> {
  await events.entered(runId, 'clarify', 'A analisar o pedido e o que falta para orçamentar')

  await events.toolStarted(runId, 'clarify', 'emit_clarify')
  const result = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: CLARIFY_SYSTEM }],
    userPrompt: `Pedido do cliente: ${caseFile.request.summary}
${caseFile.request.category ? `Categoria: ${caseFile.request.category}` : ''}
Texto original: "${caseFile.request.rawText}"

# Tarefa
Determina se há informação suficiente para orçamentar. Chama \`emit_clarify\` exatamente uma vez.`,
    toolName: 'emit_clarify',
    toolDescription: 'Emite se está pronto a orçamentar, a informação em falta e as perguntas ao cliente. Chama exatamente uma vez.',
    toolInputSchema: CLARIFY_TOOL_INPUT_SCHEMA,
    schema: ClarifySchema,
    callLabel: 'clarify',
  })
  await events.toolCompleted(runId, 'clarify', 'emit_clarify')

  caseFile.needed = result.needed
  caseFile.clarifications = result.ready
    ? []
    : result.questions.map((question) => ({ question }))
  caseFile.status = 'a_esclarecer'

  if (result.ready) {
    await events.activity(runId, 'clarify', 'Informação suficiente para orçamentar', 0.9)
  } else {
    for (const q of result.questions) {
      await events.activity(runId, 'clarify', `Pergunta ao cliente: ${q}`, 0.7)
    }
  }

  await events.output(runId, 'clarify', result.ready ? 'Pronto a orçamentar' : `${result.questions.length} perguntas ao cliente`, {
    ready: result.ready,
    needed: result.needed,
    questions: result.questions,
  })
  await events.completed(
    runId,
    'clarify',
    result.ready ? 'Sem perguntas' : `${result.questions.length} perguntas`,
    result.ready ? 'pronto' : `${result.questions.length} perguntas`,
  )
  return caseFile
}
