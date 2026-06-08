import { events, readEvents } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import {
  COMPLIANCE_TOOL_INPUT_SCHEMA,
  ComplianceResultSchema,
} from '@/lib/underwriting/schema'

const COMPLIANCE_SYSTEM = `# This call: COMPLIANCE & AUDIT

You review the full underwriting chain for regulatory and fairness adherence and confirm the audit trail is complete: every extracted field traces to a source, and every decision traces to a rationale and the agent that produced it.

## Rules
- Base your verdict ONLY on the event log + Case File provided. Do not invent issues.
- Flag anything that genuinely needs disclosure or attention: served-alcohol exposure without liquor coverage, low-confidence fields that fed a decision, an open claim, a referral that should not be auto-bound, or missing required documentation.
- If the chain is clean and well-sourced, return compliance "pass" with an empty flags array.
- The summary should briefly attest to source/rationale traceability.`

/**
 * Compliance & Audit Agent. Reads the append-only event log (the same store that
 * drives the dashboard), compiles the audit trail, and produces a compliance
 * verdict. Real — the trail is assembled from events, not fabricated.
 */
export async function runCompliance(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'compliance', 'Assembling audit trail across phases')

  const log = await readEvents(runId)
  const completed = log.filter((e) => e.type === 'node.completed')
  await events.activity(
    runId,
    'compliance',
    `Reviewing ${log.length} events across ${completed.length} phases`,
    0.4,
  )

  // Compact, decision-relevant view of the trail for the model.
  const lowConfidence = caseFile.fields.filter(
    (f) => f.value !== null && f.confidence < 0.6,
  )
  const trail = {
    phases: completed.map((e) => ({ node: e.nodeId, summary: e.payload.summary })),
    appetite: caseFile.appetite
      ? { decision: caseFile.appetite.decision, knockouts: caseFile.appetite.knockouts }
      : null,
    quote: caseFile.quote
      ? { premium: caseFile.quote.premium, simulated: caseFile.quote.simulated }
      : null,
    declined: caseFile.declined ?? false,
    requiredGaps: caseFile.gaps.filter((g) => g.severity === 'required').map((g) => g.field),
    lowConfidenceFields: lowConfidence.map((f) => ({ key: f.key, confidence: f.confidence })),
    servesAlcohol: /liquor|alcohol/i.test(
      JSON.stringify(caseFile.submission) + (caseFile.enrichment?.dossier ?? ''),
    ),
    fieldsWithSource: caseFile.fields.filter((f) => f.source?.file).length,
    totalFields: caseFile.fields.length,
  }

  await events.toolStarted(runId, 'compliance', 'emit_compliance')
  const userPrompt = `Audit trail (compiled from the event log + Case File):
${JSON.stringify(trail, null, 2)}

# Your task
Produce the compliance verdict. Call \`emit_compliance\` exactly once.`

  const verdict = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: COMPLIANCE_SYSTEM }],
    userPrompt,
    toolName: 'emit_compliance',
    toolDescription: 'Emit the compliance verdict, flags, and audit-trail summary. Call exactly once.',
    toolInputSchema: COMPLIANCE_TOOL_INPUT_SCHEMA,
    schema: ComplianceResultSchema,
    callLabel: 'compliance',
  })
  await events.toolCompleted(runId, 'compliance', 'emit_compliance')

  caseFile.audit = {
    compliance: verdict.compliance,
    flags: verdict.flags,
    summary: verdict.summary,
  }
  caseFile.status = 'complete'

  await events.output(runId, 'compliance', `Compliance: ${verdict.compliance.toUpperCase()}`, {
    compliance: verdict.compliance,
    flags: verdict.flags,
    summary: verdict.summary,
    trail,
  })
  await events.completed(
    runId,
    'compliance',
    verdict.flags.length ? `${verdict.flags.length} flag(s)` : 'Clean',
    verdict.compliance.toUpperCase(),
  )

  return caseFile
}
