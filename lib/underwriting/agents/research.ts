import { events } from '@/lib/events/emit'
import { runTool } from '@/lib/llm/run-tool'
import { sharedSystemBlock } from '@/lib/llm/prompt-shared'
import type { CaseFile } from '@/lib/underwriting/case-file'
import {
  RESEARCH_TOOL_INPUT_SCHEMA,
  ResearchResultSchema,
} from '@/lib/underwriting/schema'
import { webSearch, type SearchResult } from '@/lib/services/web-research'
import { getFirmographics, getIndustryLossTrend } from '@/lib/services/data-feeds'

const RESEARCH_SYSTEM = `# This call: RESEARCH & ENRICHMENT

You enrich a General Liability submission with external intelligence and produce a SOURCED risk narrative for the underwriter.

## Hard rules
- Every claim in the dossier and every signal must be supported by one of the provided sources (web results or the labelled data-feed snippets). Cite it.
- If web results are sparse or unavailable, say so plainly and lean on the data-feed snippets and the submission. Do not invent facts, news, or litigation.
- Surface both positive and negative signals. Be specific (years, amounts, class hazards), not generic.

## Output
- dossier: 2–4 short paragraphs an underwriter can skim.
- citations: the sources you used.
- signals: discrete positive/negative risk signals, each tied to a citation index where one exists.`

/**
 * Research / Enrichment Agent. Runs real web searches (Tavily), pulls the
 * (mocked) firmographics + industry-loss data feeds, streams each finding into
 * the node, then synthesizes a sourced dossier + risk signals via run-tool.
 */
export async function runResearch(
  runId: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  const insured = caseFile.submission.insured
  const name = insured?.name ?? caseFile.submission.broker?.name ?? 'the applicant'
  await events.entered(runId, 'research', `Enriching ${name}`)

  // 1. Real web research.
  const queries = [
    `${name} company overview`,
    `${name} lawsuit OR litigation OR claim`,
    `${insured?.naics ?? 'general liability'} industry loss trends 2025`,
  ]
  const collected: SearchResult[] = []
  let degraded = false
  for (const q of queries) {
    await events.toolStarted(runId, 'research', 'web_search')
    await events.activity(runId, 'research', `Searching: ${q}`, 0.3)
    const res = await webSearch(q, 4)
    if (res.degraded) degraded = true
    collected.push(...res.results)
    await events.toolCompleted(
      runId,
      'research',
      'web_search',
      res.degraded
        ? 'no web provider configured'
        : `${res.results.length} results`,
    )
    if (res.results[0]) {
      await events.activity(runId, 'research', `Found: ${res.results[0].title}`, 0.5)
    }
  }

  // 2. Mock paid data feeds (clearly labelled as simulated).
  await events.toolStarted(runId, 'research', 'data_feeds')
  const firmo = getFirmographics(name)
  const trend = getIndustryLossTrend(insured?.naics)
  await events.activity(
    runId,
    'research',
    `Data feed: ~${firmo.estimatedEmployees} employees, ${trend.trendDirection} loss trend`,
    0.7,
  )
  await events.toolCompleted(runId, 'research', 'data_feeds', 'firmographics + loss trend (sim)')

  // 3. Synthesize a sourced dossier.
  await events.toolStarted(runId, 'research', 'emit_research')
  const sourceText = collected
    .map((r, i) => `[web ${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join('\n\n')
  const userPrompt = `Applicant: ${name}
NAICS: ${insured?.naics ?? 'unknown'} | Address: ${insured?.address ?? 'unknown'}
Operations / class context from the submission is already known to the workflow.

## Web search results ${degraded ? '(NONE — no web provider configured)' : ''}
${sourceText || '(no web results)'}

## Data-feed snippets (SIMULATED — label as such)
[feed firmographics] ${JSON.stringify(firmo)}
[feed loss-trend] ${JSON.stringify(trend)}

# Your task
Produce the sourced risk dossier. Call \`emit_research\` exactly once.`

  const result = await runTool({
    systemBlocks: [sharedSystemBlock(), { type: 'text', text: RESEARCH_SYSTEM }],
    userPrompt,
    toolName: 'emit_research',
    toolDescription:
      'Emit the enrichment dossier, citations, and positive/negative risk signals. Call exactly once.',
    toolInputSchema: RESEARCH_TOOL_INPUT_SCHEMA,
    schema: ResearchResultSchema,
    callLabel: 'research',
  })
  await events.toolCompleted(runId, 'research', 'emit_research')

  caseFile.enrichment = {
    dossier: result.dossier,
    signals: result.signals.map((s) => ({
      polarity: s.polarity,
      text: s.text,
      citationIndex: s.citationIndex ?? undefined,
    })),
    citations: result.citations.map((c) => ({
      claim: c.claim,
      url: c.url,
      title: c.title ?? undefined,
    })),
  }
  caseFile.status = 'researching'

  const neg = result.signals.filter((s) => s.polarity === 'negative').length
  await events.output(runId, 'research', `${result.signals.length} signals, ${result.citations.length} sources`, {
    dossier: result.dossier,
    signals: caseFile.enrichment.signals,
    citations: caseFile.enrichment.citations,
  })
  await events.completed(
    runId,
    'research',
    `${result.citations.length} sources, ${neg} negative signals`,
    `${result.citations.length} sources`,
  )

  return caseFile
}
