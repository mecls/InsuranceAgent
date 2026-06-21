import { events, readEvents } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import {
  COMPLIANCE_TOOL_INPUT_SCHEMA,
  ComplianceResultSchema,
} from '@/lib/underwriting/schema'

const COMPLIANCE_SYSTEM = `# This call: COMPLIANCE & AUDIT

You review the full underwriting chain for regulatory and fairness adherence and assess whether the audit trail is complete: every extracted field should trace to a source, and every decision to a rationale and the agent that produced it.

## Rules
- Base your verdict ONLY on the event log + Case File provided. Do not invent issues.
- NEVER attest that the extraction/audit is "complete" or that "all fields trace to source" if the data shows unread documents or missing required fields. Those mean the trail is INCOMPLETE — say so plainly.
- If "unreadableDocuments" is non-empty, the agent could not read an authoritative document (e.g. the ACORD application). This is a serious finding: the decision rests on partial data. Flag it, and do not treat the resulting missing fields as if the information simply isn't in the submission.
- Flag anything that genuinely needs disclosure or attention: unread documents, missing required fields, served-alcohol exposure without liquor coverage, low-confidence fields that fed a decision, an open claim, or a referral that should not be auto-bound.
- Only return compliance "pass" with empty flags when there are no unread documents, no missing required fields, and the chain is well-sourced.
- The summary must be honest about completeness: attest traceability only to the extent the data supports it.`

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

  // Deterministic completeness/readability facts. These DECIDE the flag below;
  // the model only writes the prose. This is the guardrail that was missing:
  // previously the LLM could attest "audit complete" while documents went unread.
  const lowConfidence = caseFile.fields.filter(
    (f) => f.value !== null && f.confidence < 0.6,
  )
  const unreadableDocuments = caseFile.unreadableDocuments ?? []
  const requiredGaps = caseFile.gaps
    .filter((g) => g.severity === 'required')
    .map((g) => g.note ?? g.field)
  const nonNullFields = caseFile.fields.filter((f) => f.value !== null)
  const nonNullSourced = nonNullFields.filter((f) => f.source?.file)

  const trail = {
    phases: completed.map((e) => ({ node: e.nodeId, summary: e.payload.summary })),
    appetite: caseFile.appetite
      ? { decision: caseFile.appetite.decision, knockouts: caseFile.appetite.knockouts }
      : null,
    quote: caseFile.quote
      ? { premium: caseFile.quote.premium, simulated: caseFile.quote.simulated }
      : null,
    declined: caseFile.declined ?? false,
    unreadableDocuments,
    requiredFieldsMissing: requiredGaps,
    lowConfidenceFields: lowConfidence.map((f) => ({ key: f.key, confidence: f.confidence })),
    servesAlcohol: /liquor|alcohol/i.test(
      JSON.stringify(caseFile.submission) + (caseFile.enrichment?.dossier ?? ''),
    ),
    extractedFields: caseFile.fields.length,
    nonNullFields: nonNullFields.length,
    nonNullFieldsWithSource: nonNullSourced.length,
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

  // Deterministic guardrail: unread documents or missing required fields mean the
  // audit trail is INCOMPLETE — force a flag regardless of what the model wrote,
  // and lead with the concrete deterministic findings so the verdict can't bless
  // a partial extraction as clean.
  const deterministicFlags: string[] = []
  if (unreadableDocuments.length > 0) {
    deterministicFlags.push(
      `Extraction ran blind on ${unreadableDocuments.length} authoritative document(s): ${unreadableDocuments.join(', ')}. The decision rests on partial data; required fields cannot be attested complete.`,
    )
  }
  if (requiredGaps.length > 0) {
    deterministicFlags.push(
      `${requiredGaps.length} required field(s) missing or unread: ${requiredGaps.join(', ')}.`,
    )
  }
  const mustFlag = deterministicFlags.length > 0
  const compliance = mustFlag ? 'flag' : verdict.compliance
  // Merge deterministic flags first, then the model's (de-duplicated).
  const flags = [
    ...deterministicFlags,
    ...verdict.flags.filter(
      (f) => !deterministicFlags.some((d) => d.toLowerCase().includes(f.toLowerCase().slice(0, 24))),
    ),
  ]
  const summary = mustFlag
    ? `Audit trail INCOMPLETE: ${deterministicFlags.length} blocking finding(s) below. ${verdict.summary}`
    : verdict.summary

  caseFile.audit = { compliance, flags, summary }
  caseFile.status = 'complete'

  await events.output(runId, 'compliance', `Compliance: ${compliance.toUpperCase()}`, {
    compliance,
    flags,
    summary,
    trail,
  })
  await events.completed(
    runId,
    'compliance',
    flags.length ? `${flags.length} flag(s)` : 'Clean',
    compliance.toUpperCase(),
  )

  return caseFile
}
