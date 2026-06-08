import { Inngest, EventSchemas } from 'inngest'

/**
 * Event catalogue.
 *
 * `underwriting/run-requested` enqueues the orchestrator (one durable step
 * function per run). `underwriting/human-approval` resumes a gated step that is
 * parked on `step.waitForEvent` — the broker-email send and the bind action both
 * wait for a human to click approve in the UI.
 */
export type Events = {
  'underwriting/run-requested': { data: { runId: string } }
  'underwriting/human-approval': {
    data: {
      runId: string
      gate: 'broker_email' | 'bind'
      approved: boolean
      /** Optional field overrides the underwriter applied before approving. */
      overrides?: Record<string, string | number>
    }
  }
}

export const inngest = new Inngest({
  id: 'insuranceagent',
  schemas: new EventSchemas().fromRecord<Events>(),
})
