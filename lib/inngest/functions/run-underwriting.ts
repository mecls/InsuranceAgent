import { inngest } from '@/lib/inngest/client'
import { events } from '@/lib/events/emit'
import {
  getRunById,
  markRunFailed,
  markRunReady,
  saveCaseFile,
  setRunStatus,
} from '@/lib/db/runs'
import { emptyCaseFile, type CaseFile } from '@/lib/underwriting/case-file'
import { EDGES, NODES } from '@/lib/underwriting/nodes'
import { runIntake } from '@/lib/underwriting/agents/intake'
import { runExtraction } from '@/lib/underwriting/agents/extraction'
import { runGap } from '@/lib/underwriting/agents/gap'
import { runResearch } from '@/lib/underwriting/agents/research'
import { runAppetite } from '@/lib/underwriting/agents/appetite'
import { runPricing } from '@/lib/underwriting/agents/pricing'
import { runCompliance } from '@/lib/underwriting/agents/compliance'
import { recordHumanAction } from '@/lib/db/runs'
import { sendToOutbox } from '@/lib/services/email-sender'

/**
 * The Orchestrator. One durable Inngest step function per run. Each agent is a
 * `step.run('node:<id>', …)` that emits node.entered → activity* → completed and
 * writes its Case File slice; edges animate between phases. The Case File is
 * persisted after every node so a refresh / Replay sees the latest slice, and a
 * `run.completed`/`run.failed` event closes the live stream.
 */
export const runUnderwriting = inngest.createFunction(
  {
    id: 'run-underwriting',
    concurrency: { limit: 3 },
    retries: 1,
    onFailure: async ({ event, error }) => {
      const runId = (event?.data?.event?.data as { runId?: string } | undefined)
        ?.runId
      if (!runId) return
      const message = error instanceof Error ? error.message : String(error)
      await markRunFailed(runId, message)
      await events.runFailed(runId, message)
    },
  },
  { event: 'underwriting/run-requested' },
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

    // The Case File accumulates across nodes.
    let caseFile: CaseFile = row.case_file ?? emptyCaseFile(row.slug)

    for (const node of NODES) {
      caseFile = await step.run(`node:${node.id}`, async () => {
        switch (node.id) {
          case 'intake':
            return runIntake(runId, row.slug, row.scenario, caseFile)
          case 'extraction':
            return runExtraction(runId, caseFile)
          case 'gap':
            return runGap(runId, caseFile)
          case 'research':
            return runResearch(runId, caseFile)
          case 'appetite':
            return runAppetite(runId, caseFile)
          case 'pricing':
            return runPricing(runId, caseFile)
          case 'compliance':
            return runCompliance(runId, caseFile)
          default:
            throw new Error(`unhandled node: ${node.id}`)
        }
      })

      await step.run(`save:${node.id}`, async () => {
        await saveCaseFile(runId, caseFile)
      })

      // HITL gate: if the gap agent staged a broker clarification email, park the
      // node in awaiting_human and wait for the underwriter's send/skip decision.
      // Sending is a side effect, so it never happens autonomously.
      if (node.id === 'gap' && caseFile.brokerEmailDraft) {
        await step.run('gate-broker-email:await', async () => {
          await setRunStatus(runId, 'awaiting_human')
        })

        const approval = await step.waitForEvent('wait-broker-approval', {
          event: 'underwriting/human-approval',
          match: 'data.runId',
          timeout: '30m',
        })

        await step.run('gate-broker-email:resolve', async () => {
          await setRunStatus(runId, 'running')
          const draft = caseFile.brokerEmailDraft!
          const broker = caseFile.submission.broker
          if (approval?.data.approved) {
            await sendToOutbox({
              runId,
              to: broker?.email ?? 'broker@unknown',
              subject: draft.subject,
              body: draft.body,
            })
            await recordHumanAction(runId, 'approve_send', { subject: draft.subject })
            await events.toolCompleted(runId, 'gap', 'send_broker_email', 'sent to outbox')
            await events.completed(runId, 'gap', 'Broker email sent (outbox)', 'email sent')
          } else {
            await recordHumanAction(runId, 'reject_send', {
              reason: approval ? 'declined' : 'timeout',
            })
            await events.activity(runId, 'gap', 'Send skipped by underwriter', 1)
            await events.completed(runId, 'gap', 'Gaps noted, email not sent', 'send skipped')
          }
        })
      }

      const edge = EDGES.find((e) => e.source === node.id)
      if (edge) {
        await step.run(`edge:${node.id}`, async () => {
          await events.edgeActive(
            runId,
            edge.source,
            edge.target,
            `Case File — ${caseFile.fields.length} fields`,
          )
        })
      }
    }

    await step.run('finalize', async () => {
      caseFile.status = 'complete'
      await markRunReady(runId, caseFile)
      await events.runCompleted(runId, 'Quote assembled. Audit trail compiled.')
    })

    return { runId, status: 'ready' }
  },
)
