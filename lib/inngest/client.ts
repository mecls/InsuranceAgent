import { Inngest, EventSchemas } from 'inngest'

/**
 * Event catalogue.
 *
 * `quote/run-requested` enqueues the orchestrator (one durable step function per
 * run). `quote/request-received` triggers the light draft-parse job for a
 * free-text intake (WhatsApp/email). `quote/customer-message` feeds the
 * customer's clarifying reply into the await-customer gate.
 * `quote/human-approval` resolves the review gate — fired identically by the web
 * and Slack approve buttons.
 */
export type Events = {
  'quote/run-requested': { data: { runId: string } }
  'quote/request-received': { data: { runId: string } }
  'quote/customer-message': { data: { runId: string; text?: string } }
  'quote/human-approval': { data: { runId: string; approved: boolean } }
}

export const inngest = new Inngest({
  id: 'miraside-orcamentos',
  schemas: new EventSchemas().fromRecord<Events>(),
})
