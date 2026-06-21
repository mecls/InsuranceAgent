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

  // The premium is only reliable if the engine had real inputs AND no authoritative
  // document went unread. Otherwise it's a placeholder, not a firm indication.
  const unreadable = caseFile.unreadableDocuments ?? []
  const assumptions = [
    ...result.assumptions,
    ...(unreadable.length
      ? [`${unreadable.length} document(s) could not be read (${unreadable.join(', ')}); inputs may be incomplete.`]
      : []),
  ]
  const reliable = result.ratable && unreadable.length === 0

  await events.activity(
    runId,
    'pricing',
    reliable
      ? `Applying experience and risk-control modifiers → ${formatCurrency(result.premium)}`
      : `⚠ Insufficient data to rate — ${formatCurrency(result.premium)} is a PLACEHOLDER, not a firm indication`,
    0.7,
  )

  await events.toolStarted(runId, 'pricing', 'emit_quote_assembly')
  const reliabilityNote = reliable
    ? ''
    : `\n\nIMPORTANT — THIS PREMIUM IS NOT RELIABLE. It rests on assumed inputs:\n${assumptions.map((a) => `- ${a}`).join('\n')}\nIn the summary, state clearly that this is a non-binding placeholder pending the missing information; do NOT present it as a firm indication.`
  const userPrompt = `Indicative premium (SIMULATED rating engine): ${formatCurrency(result.premium, result.currency)}${reliable ? '' : ' [PLACEHOLDER — insufficient data]'}
Appetite decision: ${caseFile.appetite?.decision?.toUpperCase() ?? 'IN'}

Rating breakdown:
${result.breakdown.map((b) => `- ${b.label}: ${b.kind === 'modifier' ? `×${b.value}` : formatCurrency(b.value)}${b.detail ? ` (${b.detail})` : ''}`).join('\n')}

Insured: ${caseFile.submission.insured?.name ?? 'applicant'} | Limits: ${formatCurrency(caseFile.submission.coverage?.occurrenceLimit ?? 0)} occ / ${formatCurrency(caseFile.submission.coverage?.aggregateLimit ?? 0)} agg${reliabilityNote}

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
    reliable,
    assumptions,
  }
  caseFile.status = 'pricing'

  await events.output(runId, 'pricing', `Quote: ${formatCurrency(result.premium)} (simulated)`, {
    premium: result.premium,
    breakdown: result.breakdown,
    summary: assembly.summary,
    preBindChecklist: assembly.preBindChecklist,
    reliable,
    assumptions,
  })
  await events.completed(
    runId,
    'pricing',
    reliable
      ? `${formatCurrency(result.premium)} indicative`
      : `${formatCurrency(result.premium)} placeholder — insufficient data`,
    reliable ? `${formatCurrency(result.premium)} (sim)` : 'INSUFFICIENT DATA',
  )

  return caseFile
}
