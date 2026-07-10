import { inngest } from '@/lib/inngest/client'
import { getRunById, saveCaseFile } from '@/lib/db/runs'
import { emptyCaseFile } from '@/lib/procurement/case-file'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import { PARSE_REQUEST_TOOL_INPUT_SCHEMA, ParseRequestSchema } from '@/lib/procurement/schema'
import { getAutomate } from '@/lib/db/settings'

const PARSE_SYSTEM = `# Esta chamada: INTERPRETAR O PEDIDO

Lês uma mensagem livre de um cliente (WhatsApp, email ou formulário) e extrais o pedido de forma estruturada, em Português de Portugal. Não inventes requisitos que a mensagem não contém.`

/**
 * Prepare-draft. For a free-text intake (WhatsApp/email), LLM-parses the raw
 * message into a structured request on the DRAFT case, then either auto-starts
 * the run (global Automate ON) or leaves it as a draft for the user to review.
 */
export const prepareDraft = inngest.createFunction(
  { id: 'prepare-draft', retries: 1 },
  { event: 'quote/request-received' },
  async ({ event, step }) => {
    const { runId } = event.data

    const row = await step.run('fetch', async () => {
      const r = await getRunById(runId)
      if (!r) throw new Error(`run not found: ${runId}`)
      return r
    })

    const caseFile = row.case_file ?? emptyCaseFile(row.slug)

    const parsed = await step.run('parse', () =>
      runTool({
        systemBlocks: [sharedSystemBlock(), { type: 'text', text: PARSE_SYSTEM }],
        userPrompt: `Mensagem do cliente:\n"""\n${caseFile.request.rawText}\n"""\n\n# Tarefa\nInterpreta o pedido. Chama \`emit_parse_request\` exatamente uma vez.`,
        toolName: 'emit_parse_request',
        toolDescription: 'Emite o pedido estruturado (nome do cliente, resumo, categoria, setor). Chama exatamente uma vez.',
        toolInputSchema: PARSE_REQUEST_TOOL_INPUT_SCHEMA,
        schema: ParseRequestSchema,
        callLabel: 'prepare-draft',
      }),
    )

    const automate = await step.run('save', async () => {
      caseFile.request.summary = parsed.summary
      caseFile.request.category = parsed.category
      caseFile.vertical = parsed.vertical
      if (parsed.customerName && !caseFile.customer.name) caseFile.customer.name = parsed.customerName
      caseFile.status = 'rascunho'
      caseFile.automate = await getAutomate()
      await saveCaseFile(runId, caseFile)
      return caseFile.automate
    })

    if (automate) {
      await step.sendEvent('start', { name: 'quote/run-requested', data: { runId } })
    }

    return { runId, automate }
  },
)
