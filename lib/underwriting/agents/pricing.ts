import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { rate } from '@/lib/services/rating-engine'
import {
  QUOTE_ASSEMBLY_TOOL_INPUT_SCHEMA,
  QuoteAssemblySchema,
} from '@/lib/underwriting/schema'
import { formatCurrency } from '@/lib/format'

const PRICING_SYSTEM = `# This call: QUOTE ASSEMBLY

The premium and rating breakdown have already been computed by the rating engine (SIMULATED) and are given to you. Your job is to assemble the quote summary and the pre-bind checklist.

## Rules
- Do NOT recompute, restate, or second-guess the premium math. Reference it qualitatively if needed.
- Write a tight one-paragraph summary an underwriter can paste into a quote letter.
- The pre-bind checklist should list concrete subjectivities (signed application, COIs from subcontractors, loss-control items, any referral conditions).`

/**
 * Pricing & Quote-Assembly Agent. Prices via the SIMULATED RatingEngine
 * (deterministic — the LLM never does the math) and has the model assemble the
 * quote summary + pre-bind checklist. Out-of-appetite cases are not priced.
 */
export async function runPricing(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'pricing', 'Pricing the risk')

  if (caseFile.appetite?.decision === 'out') {
    await events.activity(runId, 'pricing', 'Out of appetite — no quote produced', 1)
    await events.output(runId, 'pricing', 'Declined — out of appetite')
    await events.completed(runId, 'pricing', 'Declined', 'DECLINED')
    caseFile.declined = true
    caseFile.status = 'pricing'
    return caseFile
  }

  await events.activity(runId, 'pricing', 'Base premium computed (rating engine — simulated)', 0.4)
  const result = rate(caseFile)
  await events.activity(
    runId,
    'pricing',
    `Applying experience and risk-control modifiers → ${formatCurrency(result.premium)}`,
    0.7,
  )

  await events.toolStarted(runId, 'pricing', 'emit_quote_assembly')
  const userPrompt = `Indicative premium (SIMULATED rating engine): ${formatCurrency(result.premium, result.currency)}
Appetite decision: ${caseFile.appetite?.decision?.toUpperCase() ?? 'IN'}

Rating breakdown:
${result.breakdown.map((b) => `- ${b.label}: ${b.kind === 'modifier' ? `×${b.value}` : formatCurrency(b.value)}${b.detail ? ` (${b.detail})` : ''}`).join('\n')}

Insured: ${caseFile.submission.insured?.name ?? 'applicant'} | Limits: ${formatCurrency(caseFile.submission.coverage?.occurrenceLimit ?? 0)} occ / ${formatCurrency(caseFile.submission.coverage?.aggregateLimit ?? 0)} agg

# Your task
Assemble the quote. Call \`emit_quote_assembly\` exactly once.`

  const assembly = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: PRICING_SYSTEM }],
    userPrompt,
    toolName: 'emit_quote_assembly',
    toolDescription: 'Emit the quote summary + pre-bind checklist. Call exactly once.',
    toolInputSchema: QUOTE_ASSEMBLY_TOOL_INPUT_SCHEMA,
    schema: QuoteAssemblySchema,
    callLabel: 'pricing',
  })
  await events.toolCompleted(runId, 'pricing', 'emit_quote_assembly')

  caseFile.quote = {
    premium: result.premium,
    currency: result.currency,
    summary: assembly.summary,
    ratingBreakdown: result.breakdown,
    preBindChecklist: assembly.preBindChecklist.map((item) => ({ item, done: false })),
    simulated: true,
  }
  caseFile.status = 'pricing'

  await events.output(runId, 'pricing', `Quote: ${formatCurrency(result.premium)} (simulated)`, {
    premium: result.premium,
    breakdown: result.breakdown,
    summary: assembly.summary,
    preBindChecklist: assembly.preBindChecklist,
  })
  await events.completed(
    runId,
    'pricing',
    `${formatCurrency(result.premium)} indicative`,
    `${formatCurrency(result.premium)} (sim)`,
  )

  return caseFile
}
