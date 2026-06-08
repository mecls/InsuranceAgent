'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { inngest } from '@/lib/inngest/client'
import { bindPolicy, createRun, recordHumanAction } from '@/lib/db/runs'

/**
 * Start a demo run. Phase 0: there is no real upload yet, so this seeds a run
 * from one of the synthetic scenarios and enqueues the orchestrator (which runs
 * stub nodes that only emit events). Phase 1 wires the real `.eml`/PDF/xlsx
 * intake; the scenario label is what the orchestrator resolves to a packet.
 */
const SCENARIOS: Record<string, string> = {
  clean: 'Northwind Logistics LLC — GL new business (clean)',
  referral: 'Apex Demolition Inc — GL new business (referral)',
  gappy: 'Riverside Catering Co — GL new business (missing fields)',
}

export async function startDemoRun(formData: FormData): Promise<void> {
  const scenario = String(formData.get('scenario') ?? 'clean')
  const submissionLabel = SCENARIOS[scenario] ?? SCENARIOS.clean

  const { id, slug } = await createRun({ submissionLabel, scenario })
  await inngest.send({
    name: 'underwriting/run-requested',
    data: { runId: id },
  })

  revalidatePath('/dashboard')
  redirect(`/dashboard/runs/${slug}`)
}

/**
 * Bind the quote — a GATED action. Writes a demo policy record (the PAS
 * integration point in production) and logs the human action. Optional
 * `overridePremium` lets the underwriter adjust the bound premium first.
 */
export async function bindQuote(
  runId: string,
  overridePremium?: number,
): Promise<{ policyNumber: string }> {
  if (overridePremium != null && Number.isFinite(overridePremium)) {
    await recordHumanAction(runId, 'override_field', {
      field: 'quote.premium',
      value: overridePremium,
    })
  }
  const policyNumber = await bindPolicy(runId)
  await recordHumanAction(runId, 'bind', { policyNumber })
  return { policyNumber }
}

/**
 * Respond to the broker-email send gate. Resumes the parked orchestrator step
 * via the human-approval event; the worker sends to the demo outbox (or skips)
 * and continues the pipeline.
 */
export async function respondBrokerEmail(
  runId: string,
  approved: boolean,
): Promise<void> {
  await inngest.send({
    name: 'underwriting/human-approval',
    data: { runId, gate: 'broker_email', approved },
  })
}
