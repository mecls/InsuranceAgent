import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { evaluateAppetite } from '@/lib/underwriting/gl-rules'
import {
  APPETITE_RATIONALE_TOOL_INPUT_SCHEMA,
  AppetiteRationaleSchema,
} from '@/lib/underwriting/schema'
import {
  getGuidelinesByRef,
  retrieveGuidelines,
} from '@/lib/services/guideline-store'

const APPETITE_SYSTEM = `# This call: APPETITE RATIONALE

The appetite DECISION and SCORE have already been computed deterministically by the carrier ruleset and are given to you as ground truth. Your job is ONLY to write the human-facing rationale.

## Rules
- Do NOT change or second-guess the decision or score. Explain it.
- Each reason MUST cite the rule id it comes from (e.g. APP-LOSS-01) and the relevant guideline section quoted below.
- Be specific and concrete. One short bullet per material factor.
- For each knockout, give a one-line explanation. If there are no knockouts, return an empty array.`

/**
 * Appetite & Risk Agent. Runs the deterministic appetite ruleset, retrieves the
 * cited GL manual sections (GuidelineStore), then has the model write the
 * sourced rationale. Refer / over-authority / out-of-appetite cases are surfaced
 * for the underwriter. The decision and score are never LLM-derived.
 */
export async function runAppetite(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'appetite', 'Evaluating appetite ruleset')

  const evaln = evaluateAppetite(caseFile)
  await events.activity(
    runId,
    'appetite',
    `Evaluating ${evaln.rules.length} appetite rules`,
    0.3,
  )
  for (const r of evaln.rules) {
    if (r.outcome !== 'pass') {
      await events.activity(
        runId,
        'appetite',
        `${r.ruleId}: ${r.outcome.toUpperCase()} — ${r.detail}`,
        0.6,
      )
    }
  }

  // Retrieve the cited guideline sections + anything class/loss relevant.
  const refs = evaln.rules.map((r) => r.guidelineRef).filter(Boolean) as string[]
  const cited = getGuidelinesByRef(refs)
  const topical = retrieveGuidelines(
    `${caseFile.submission.insured?.naics ?? ''} loss experience binding authority`,
    3,
  )
  const guidelines = [...cited, ...topical.filter((t) => !refs.includes(t.ref))]

  await events.toolStarted(runId, 'appetite', 'emit_appetite_rationale')
  const userPrompt = `Decision (ground truth): ${evaln.decision.toUpperCase()} | Score: ${evaln.score.toFixed(2)}

Rule evaluations:
${evaln.rules.map((r) => `- ${r.ruleId} [${r.outcome}] ${r.description}: ${r.detail} (cites ${r.guidelineRef})`).join('\n')}

Knockouts: ${evaln.knockouts.length ? evaln.knockouts.join('; ') : 'none'}

Relevant GL manual sections:
${guidelines.map((g) => `[${g.ref}] ${g.text}`).join('\n\n')}

# Your task
Write the rationale. Call \`emit_appetite_rationale\` exactly once.`

  const rationale = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: APPETITE_SYSTEM }],
    userPrompt,
    toolName: 'emit_appetite_rationale',
    toolDescription:
      'Emit the appetite reasons (each citing a rule id + guideline section) and any knockout explanations. Call exactly once.',
    toolInputSchema: APPETITE_RATIONALE_TOOL_INPUT_SCHEMA,
    schema: AppetiteRationaleSchema,
    callLabel: 'appetite',
  })
  await events.toolCompleted(runId, 'appetite', 'emit_appetite_rationale')

  caseFile.appetite = {
    decision: evaln.decision,
    score: evaln.score,
    reasons: rationale.reasons,
    knockouts: evaln.knockouts,
    rules: evaln.rules,
  }
  caseFile.status = 'appetite'

  await events.output(runId, 'appetite', `Decision: ${evaln.decision.toUpperCase()}`, {
    decision: evaln.decision,
    score: evaln.score,
    rules: evaln.rules,
    reasons: rationale.reasons,
    knockoutExplanations: rationale.knockoutExplanations,
  })
  await events.completed(
    runId,
    'appetite',
    `${evaln.decision.toUpperCase()} (score ${evaln.score.toFixed(2)})`,
    evaln.decision.toUpperCase(),
  )

  return caseFile
}
