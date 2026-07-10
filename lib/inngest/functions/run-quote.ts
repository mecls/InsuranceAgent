import { inngest } from '@/lib/inngest/client'
import { events } from '@/lib/events/emit'
import {
  getRunById,
  markRunFailed,
  markRunReady,
  recordHumanAction,
  saveCaseFile,
  setRunStatus,
} from '@/lib/db/runs'
import {
  customerLabel,
  emptyCaseFile,
  openQuestions,
  type CaseFile,
} from '@/lib/procurement/case-file'
import { EDGES, NODES } from '@/lib/procurement/nodes'
import { runIntake } from '@/lib/procurement/agents/intake'
import { runClarify } from '@/lib/procurement/agents/clarify'
import { runPrice } from '@/lib/procurement/agents/price'
import { runDraftQuote } from '@/lib/procurement/agents/draft-quote'
import { runSendQuote } from '@/lib/procurement/agents/send-quote'
import { sendToCustomer } from '@/lib/services/customer-comms'
import { getScenario, isDemoScenario } from '@/lib/demo/scenarios'
import { euro } from '@/lib/procurement/pricing'
import { postRunUpdate, buildQuoteBlocks } from '@/lib/services/slack'

/**
 * The Orchestrator. One durable Inngest step function per quoting run. Nodes:
 * intake → clarify → await-customer → price → draft-quote → review → send. Two
 * gates park the run:
 *  - await-customer sends the clarifying questions, waits for the customer's reply
 *    and chases if silent (demo self-drives the reply so it plays on camera).
 *  - review waits for the user to approve the quote (`quote/human-approval`) unless
 *    the case is in Automate mode, in which case it auto-approves and auto-sends.
 */
export const runQuote = inngest.createFunction(
  {
    id: 'run-quote',
    concurrency: { limit: 5 },
    retries: 1,
    onFailure: async ({ event, error }) => {
      const runId = (event?.data?.event?.data as { runId?: string } | undefined)?.runId
      if (!runId) return
      const message = error instanceof Error ? error.message : String(error)
      await markRunFailed(runId, message)
      await events.runFailed(runId, message)
    },
  },
  { event: 'quote/run-requested' },
  async ({ event, step }) => {
    const { runId } = event.data

    const row = await step.run('fetch-run', async () => {
      const r = await getRunById(runId)
      if (!r) throw new Error(`run not found: ${runId}`)
      return r
    })

    await step.run('run-started', async () => {
      await setRunStatus(runId, 'running')
      await events.runStarted(runId, row.submission_label)
    })

    const demo = isDemoScenario(row.scenario)
    let caseFile: CaseFile = row.case_file ?? emptyCaseFile(row.slug)
    let approved = caseFile.automate

    // ── await-customer: send questions, wait + chase for the customer's reply ──
    const runAwaitCustomer = async (): Promise<void> => {
      const questions = openQuestions(caseFile)
      if (questions.length === 0) {
        await step.run('await:skip', async () => {
          await events.entered(runId, 'await-customer', 'Sem perguntas a fazer ao cliente')
          await events.completed(runId, 'await-customer', 'Nada a esclarecer', 'ok')
        })
        return
      }

      await step.run('await:enter', async () => {
        await events.entered(runId, 'await-customer', 'A enviar perguntas ao cliente e a aguardar resposta')
        await sendToCustomer({
          runId,
          caseFile,
          subject: `Pedido de esclarecimento — ${caseFile.request.summary}`,
          text: `Boa tarde,\n\nPara podermos preparar o orçamento, precisamos de saber:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}\n\nObrigado.`,
        })
        if (!demo) {
          await events.awaitingHuman(runId, 'await-customer', 'A aguardar a resposta do cliente. A perseguir se não responder.')
          await setRunStatus(runId, 'awaiting_human')
        }
      })

      if (demo) {
        const answer = getScenario(row.scenario)?.customerAnswer ?? ''
        await step.sleep('await-sleep-1', '5s')
        caseFile = await step.run('await-chase', async () => {
          await events.activity(runId, 'await-customer', `Sem resposta de ${customerLabel(caseFile)}. A reenviar a mensagem.`, 0.5)
          await sendToCustomer({ runId, caseFile, subject: 'Reforço do pedido de esclarecimento', text: 'Reforçamos o pedido anterior. Agradecemos uma resposta quando possível.' })
          return caseFile
        })
        await step.sleep('await-sleep-2', '5s')
        caseFile = await step.run('await-answer', async () => {
          applyCustomerAnswer(caseFile, answer)
          await events.activity(runId, 'await-customer', `${customerLabel(caseFile)} respondeu: ${answer}`, 0.9)
          return caseFile
        })
      } else {
        const timers = ['3d', '4d', '3d']
        for (let round = 0; round < timers.length; round++) {
          if (openQuestions(caseFile).length === 0) break
          const evt = await step.waitForEvent(`wait-customer-${round}`, {
            event: 'quote/customer-message',
            match: 'data.runId',
            timeout: timers[round],
          })
          if (evt) {
            caseFile = await step.run(`apply-answer-${round}`, async () => {
              applyCustomerAnswer(caseFile, evt.data.text ?? '')
              await events.activity(runId, 'await-customer', `${customerLabel(caseFile)} respondeu`, 0.9)
              return caseFile
            })
          } else {
            caseFile = await step.run(`chase-${round}`, async () => {
              await events.activity(runId, 'await-customer', 'Sem resposta do cliente. A reenviar.', 0.5)
              await sendToCustomer({ runId, caseFile, subject: 'Reforço do pedido de esclarecimento', text: 'Reforçamos o pedido anterior. Agradecemos uma resposta quando possível.' })
              return caseFile
            })
          }
        }
      }

      caseFile = await step.run('await:done', async () => {
        if (!demo) await setRunStatus(runId, 'running')
        caseFile.status = 'a_orcamentar'
        await events.output(runId, 'await-customer', 'Esclarecimentos recolhidos', { clarifications: caseFile.clarifications })
        await events.completed(runId, 'await-customer', 'Cliente esclareceu', 'esclarecido')
        return caseFile
      })
    }

    // ── review: park for approval unless Automate ──────────────────────────────
    const runReview = async (): Promise<void> => {
      if (caseFile.automate) {
        await step.run('review:auto', async () => {
          await events.entered(runId, 'review', 'Modo Automatizar: aprovação automática')
          await recordHumanAction(runId, 'adjudicate', { auto: true })
          await events.completed(runId, 'review', 'Aprovado automaticamente', 'auto')
        })
        approved = true
        return
      }

      await step.run('review:enter', async () => {
        await events.entered(runId, 'review', 'A aguardar revisão e aprovação')
        await events.awaitingHuman(runId, 'review', 'Orçamento pronto. Reveja e aprove para enviar ao cliente.')
        await setRunStatus(runId, 'awaiting_human')
        if (caseFile.source?.type === 'slack') {
          await postRunUpdate(runId, 'Orçamento pronto.', buildQuoteBlocks(caseFile, runId))
        }
      })
      const decision = await step.waitForEvent('wait-review', {
        event: 'quote/human-approval',
        match: 'data.runId',
        timeout: '7d',
      })
      approved = !!decision?.data.approved
      caseFile = await step.run('review:resolve', async () => {
        await setRunStatus(runId, 'running')
        if (approved) {
          await recordHumanAction(runId, 'adjudicate', {})
          await events.completed(runId, 'review', 'Orçamento aprovado', 'aprovado')
        } else {
          caseFile.closedWithoutQuote = true
          caseFile.status = 'fechado'
          await recordHumanAction(runId, 'reject_quote', { reason: decision ? 'rejeitado' : 'timeout' })
          await events.completed(runId, 'review', 'Não enviado', 'não enviado')
        }
        return caseFile
      })
    }

    const runSendNode = async (): Promise<void> => {
      if (!approved) {
        await step.run('node:send', async () => {
          await events.entered(runId, 'send', 'Sem envio')
          await events.completed(runId, 'send', 'Orçamento não enviado', 'sem envio')
        })
        return
      }
      caseFile = await step.run('node:send', () => runSendQuote(runId, caseFile, new Date().toISOString()))
    }

    for (const node of NODES) {
      if (node.id === 'await-customer') {
        await runAwaitCustomer()
      } else if (node.id === 'review') {
        await runReview()
      } else if (node.id === 'send') {
        await runSendNode()
      } else {
        caseFile = await step.run(`node:${node.id}`, async () => {
          switch (node.id) {
            case 'intake':
              return runIntake(runId, caseFile)
            case 'clarify':
              return runClarify(runId, caseFile)
            case 'price':
              return runPrice(runId, caseFile)
            case 'draft-quote':
              return runDraftQuote(runId, caseFile)
            default:
              throw new Error(`unhandled node: ${node.id}`)
          }
        })
      }

      await step.run(`save:${node.id}`, async () => {
        await saveCaseFile(runId, caseFile)
      })

      const edge = EDGES.find((e) => e.source === node.id)
      if (edge) {
        await step.run(`edge:${node.id}`, async () => {
          await events.edgeActive(runId, edge.source, edge.target, edgeLabel(caseFile))
        })
      }
    }

    await step.run('finalize', async () => {
      await markRunReady(runId, caseFile)
      const summary = caseFile.sent
        ? `Orçamento enviado (${euro(caseFile.pricing?.total)}).`
        : 'Processo concluído sem envio.'
      await events.runCompleted(runId, summary)
      if (caseFile.source?.type === 'slack') {
        await postRunUpdate(runId, `:white_check_mark: ${summary}`)
      }
    })

    return { runId, status: 'ready' }
  },
)

function applyCustomerAnswer(caseFile: CaseFile, text: string): void {
  const now = new Date().toISOString()
  const open = caseFile.clarifications.filter((c) => !c.answer)
  if (open.length === 0) {
    caseFile.clarifications.push({ question: 'Mensagem do cliente', answer: text, answeredAt: now })
    return
  }
  for (const c of open) {
    c.answer = text
    c.answeredAt = now
  }
}

function edgeLabel(caseFile: CaseFile): string {
  if (caseFile.pricing) return `${euro(caseFile.pricing.total)}`
  return caseFile.request.summary.slice(0, 24)
}
