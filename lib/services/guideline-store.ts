/**
 * GuidelineStore — retrieval over the carrier's GL underwriting manual. The
 * appetite agent cites the snippets returned here so every decision is sourced.
 *
 * Demo: an in-repo sample manual with lightweight keyword retrieval (real
 * retrieval, no external infra). The interface is deliberately the same shape a
 * vector store would expose, so this can be upgraded to embeddings-based RAG
 * (e.g. the Supabase gte-small Edge Function) without touching the agent.
 */

export interface GuidelineChunk {
  ref: string
  title: string
  text: string
}

const MANUAL: GuidelineChunk[] = [
  {
    ref: 'GL-MANUAL §1.1 Submission Requirements',
    title: 'Submission Requirements',
    text: 'A bindable GL submission requires a completed ACORD 125, GL supplemental, named insured, FEIN, NAICS, mailing address, requested limits, rating exposure (payroll or sales), and three years of currently valued loss runs. Incomplete submissions are referred pending clarification.',
  },
  {
    ref: 'GL-MANUAL §1.4 Binding Authority',
    title: 'Binding Authority',
    text: 'Automated binding authority is limited to a $1,000,000 per-occurrence limit and $2,000,000 general aggregate. Requests above these limits must be referred to a company underwriter.',
  },
  {
    ref: 'GL-MANUAL §2.1 Eligible Classes',
    title: 'Eligible Classes',
    text: 'Standard GL appetite covers mercantile, service, light contracting, warehousing, and hospitality risks. Prohibited or restricted classes include demolition, blasting, asbestos/lead abatement, and other high-hazard operations involving collapse or explosion exposure. These are knockouts for automated quoting.',
  },
  {
    ref: 'GL-MANUAL §3.2 New Ventures',
    title: 'New Ventures',
    text: 'Applicants with fewer than three years of operating history are referred. Underwriters may consider relevant prior experience of the principals and require additional risk controls.',
  },
  {
    ref: 'GL-MANUAL §4.3 Loss Experience',
    title: 'Loss Experience',
    text: 'Three-year incurred losses exceeding $500,000, or any open claim in litigation, trigger a referral. Underwriters evaluate loss frequency and severity, the maturity of open claims, and any corrective risk-management actions.',
  },
  {
    ref: 'GL-MANUAL §5.1 Liquor Liability',
    title: 'Liquor Liability',
    text: 'Operations that serve or furnish alcoholic beverages must complete the liquor liability section. GL does not cover liquor liability; a separate coverage part or referral is required where alcohol is served.',
  },
  {
    ref: 'GL-MANUAL §6.2 Subcontractors',
    title: 'Subcontractors',
    text: 'Where subcontractors are used, written contracts with hold-harmless agreements and certificates of insurance are expected. Inconsistent contractual risk transfer is a negative underwriting factor.',
  },
]

function score(chunk: GuidelineChunk, terms: string[]): number {
  const hay = (chunk.title + ' ' + chunk.text + ' ' + chunk.ref).toLowerCase()
  return terms.reduce((s, t) => (t.length > 2 && hay.includes(t) ? s + 1 : s), 0)
}

/** Retrieve the most relevant manual sections for a query. */
export function retrieveGuidelines(query: string, k = 4): GuidelineChunk[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const ranked = MANUAL.map((c) => ({ c, s: score(c, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.c)
  // Always include the eligible-classes + binding-authority anchors if nothing matched.
  return ranked.length > 0 ? ranked : MANUAL.slice(0, k)
}

/** Fetch specific sections by ref (e.g. the refs a rule evaluation cited). */
export function getGuidelinesByRef(refs: string[]): GuidelineChunk[] {
  return MANUAL.filter((c) => refs.includes(c.ref))
}
