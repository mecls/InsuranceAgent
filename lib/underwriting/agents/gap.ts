import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { findGaps } from '@/lib/underwriting/gl-rules'
import {
  BROKER_EMAIL_TOOL_INPUT_SCHEMA,
  BrokerEmailSchema,
} from '@/lib/underwriting/schema'

const GAP_SYSTEM = `# This call: BROKER CLARIFICATION EMAIL

The submission is missing required fields. Draft a short, professional email to the broker requesting exactly the missing items. Do not send it; it is staged for underwriter approval.

## Rules
- List only the missing items provided to you, phrased as a clear numbered request.
- Be concise and courteous. Sign as "Underwriting Desk".
- Do not invent context or promise terms.`

/**
 * Gap & Broker-Comms Agent. Validates completeness against the GL required-fields
 * checklist (deterministic) and, if anything required is missing, drafts a
 * clarification email. The send is a GATED action — the draft is staged and the
 * node signals awaiting_human; a human approves in the UI (Phase 4 wires the
 * Inngest waitForEvent gate).
 */
export async function runGap(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'gap', 'Checking GL required fields')

  const gaps = findGaps(caseFile)
  caseFile.gaps = gaps
  const required = gaps.filter((g) => g.severity === 'required')

  await events.activity(
    runId,
    'gap',
    required.length === 0
      ? 'All required fields present'
      : `${required.length} required field(s) missing: ${required.map((g) => g.note).join(', ')}`,
    0.5,
  )

  if (required.length === 0) {
    await events.output(runId, 'gap', 'Submission complete', { gaps })
    await events.completed(runId, 'gap', 'No gaps', 'complete')
    caseFile.status = 'researching'
    return caseFile
  }

  // Draft the clarification email (real), but do not send (gated).
  await events.toolStarted(runId, 'gap', 'emit_broker_email')
  const broker = caseFile.submission.broker
  const userPrompt = `Broker: ${broker?.name ?? 'broker'} <${broker?.email ?? 'unknown'}>
Insured: ${caseFile.submission.insured?.name ?? 'the applicant'}

Missing required items:
${required.map((g, i) => `${i + 1}. ${g.note} (${g.field})`).join('\n')}

# Your task
Draft the clarification email. Call \`emit_broker_email\` exactly once.`

  const draft = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: GAP_SYSTEM }],
    userPrompt,
    toolName: 'emit_broker_email',
    toolDescription: 'Emit the broker clarification email (subject + body). Call exactly once.',
    toolInputSchema: BROKER_EMAIL_TOOL_INPUT_SCHEMA,
    schema: BrokerEmailSchema,
    callLabel: 'gap-broker-email',
  })
  await events.toolCompleted(runId, 'gap', 'emit_broker_email')

  caseFile.brokerEmailDraft = draft
  caseFile.status = 'gap_check'

  await events.output(runId, 'gap', 'Clarification email drafted (staged)', {
    gaps,
    draft,
  })
  // Do NOT emit node.completed here — the orchestrator parks the node in
  // awaiting_human, waits for the human send/skip decision, then completes it.
  await events.awaitingHuman(
    runId,
    'gap',
    `${required.length} gaps — broker email drafted, awaiting send approval`,
  )

  return caseFile
}
