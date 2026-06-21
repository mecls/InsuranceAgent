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

## THE APPLICATION IS AUTHORITATIVE (most important rule)
- The submission/application figures given to you under "Application facts" are GROUND TRUTH. Never contradict them.
- For any figure the application already provides (revenue, payroll, headcount, years in business, address, NAICS), use the APPLICATION's number. Do NOT substitute, "correct", or restate it with a data-feed estimate.
- Third-party data-feed values are UNVERIFIED ESTIMATES. Only use a feed number for something the application does NOT state, and when you do, explicitly label it "unverified third-party estimate".
- If a feed value conflicts with the application, the application wins. Either omit the feed value or flag the discrepancy as a data-quality note; never present the feed number as the firm's actual figure.

## Hard rules
- Every claim in the dossier and every signal must be supported by one of the provided sources (web results, the labelled data-feed snippets, or the application facts). Cite it.
- If web results are sparse or unavailable, say so plainly and lean on the application facts. Do not invent facts, news, or litigation.
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

  // 2. Mock paid data feeds (clearly labelled as simulated). Reconcile the
  // firmographic feed against the application: the application is authoritative,
  // so drop any feed figure the application already provides. This prevents the
  // feed's invented numbers from being surfaced as findings that contradict the
  // source document (a dangerous failure mode).
  await events.toolStarted(runId, 'research', 'data_feeds')
  const firmo = getFirmographics(name)
  const trend = getIndustryLossTrend(insured?.naics)

  const appHasRevenue = (caseFile.submission.exposures ?? []).some((e) =>
    /sales|revenue|receipts/i.test(e.basis),
  )
  const appHasYears = insured?.yearsInBusiness != null
  const feedEstimates: Record<string, unknown> = {
    estimatedEmployees: firmo.estimatedEmployees, // application doesn't capture headcount
    source: firmo.source,
    note: 'unverified third-party estimate; application figures govern',
  }
  if (!appHasRevenue) feedEstimates.estimatedRevenueUsd = firmo.estimatedRevenueUsd
  if (!appHasYears) feedEstimates.yearsInBusiness = firmo.yearsInBusiness

  await events.activity(
    runId,
    'research',
    `Data feed (unverified estimate): ~${firmo.estimatedEmployees} employees; ${trend.trendDirection} industry loss trend`,
    0.7,
  )
  await events.toolCompleted(runId, 'research', 'data_feeds', 'firmographics + loss trend (sim)')

  // 3. Synthesize a sourced dossier. Application facts are passed as ground truth.
  await events.toolStarted(runId, 'research', 'emit_research')
  const sourceText = collected
    .map((r, i) => `[web ${i + 1}] ${r.title}\n${r.url}\n${r.content}`)
    .join('\n\n')
  const exposuresText = (caseFile.submission.exposures ?? [])
    .map((e) => `${e.basis}: $${e.amount.toLocaleString()}`)
    .join('; ')
  const loss = caseFile.submission.lossHistory ?? []
  const applicationFacts = {
    insuredName: insured?.name ?? null,
    naics: insured?.naics ?? null,
    address: insured?.address ?? null,
    yearsInBusiness: insured?.yearsInBusiness ?? null,
    exposures: exposuresText || null,
    lossSummary: loss.length
      ? `${loss.reduce((s, y) => s + y.claims, 0)} claims / $${loss
          .reduce((s, y) => s + y.incurred, 0)
          .toLocaleString()} incurred over ${loss.length} year(s)`
      : null,
    unreadableDocuments: caseFile.unreadableDocuments ?? [],
  }
  const userPrompt = `Applicant: ${name}

## Application facts (AUTHORITATIVE — never contradict; use these figures verbatim)
${JSON.stringify(applicationFacts, null, 2)}
${
  applicationFacts.unreadableDocuments.length
    ? `\nNote: some application documents could not be read (${applicationFacts.unreadableDocuments.join(', ')}). Do NOT fill the resulting gaps with data-feed estimates presented as fact; treat them as unknown.`
    : ''
}

## Web search results ${degraded ? '(NONE — no web provider configured)' : ''}
${sourceText || '(no web results)'}

## Data-feed snippets (SIMULATED, UNVERIFIED — use only for fields the application lacks, and label as estimates)
[feed firmographics] ${JSON.stringify(feedEstimates)}
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
