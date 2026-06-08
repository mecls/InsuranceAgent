import type { CaseFile, Gap, RuleEvaluation } from '@/lib/underwriting/case-file'

/**
 * Carrier configuration for Commercial General Liability: the required-fields
 * checklist (drives the gap check) and the appetite ruleset (drives the
 * decision). Both are DETERMINISTIC — the math and the decision live here, not
 * in the LLM. Agents use these outputs and the LLM only writes the human-facing
 * rationale (citing the rule ids + guideline refs). Production swaps this config
 * for the carrier's actual manual without touching agent logic.
 */

// Per-occurrence limit this demo carrier's automated authority can bind without
// a human underwriter. Above this → refer.
export const BIND_AUTHORITY_OCCURRENCE = 1_000_000

// GL classes outside appetite (knockout). NAICS or class-code match.
const PROHIBITED_NAICS = new Set(['238910']) // site prep / demolition
const PROHIBITED_CLASS_CODES = new Set(['98090']) // demolition

interface RequiredField {
  key: string
  label: string
  severity: Gap['severity']
  present: (c: CaseFile) => boolean
}

const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'insured.name', label: 'Named insured', severity: 'required', present: (c) => !!c.submission.insured?.name },
  { key: 'insured.fein', label: 'FEIN', severity: 'required', present: (c) => !!c.submission.insured?.fein },
  { key: 'insured.naics', label: 'NAICS code', severity: 'required', present: (c) => !!c.submission.insured?.naics },
  { key: 'insured.address', label: 'Mailing address', severity: 'required', present: (c) => !!c.submission.insured?.address },
  { key: 'insured.yearsInBusiness', label: 'Years in business', severity: 'required', present: (c) => c.submission.insured?.yearsInBusiness != null },
  { key: 'coverage.occurrenceLimit', label: 'Per-occurrence limit', severity: 'required', present: (c) => c.submission.coverage?.occurrenceLimit != null },
  { key: 'coverage.aggregateLimit', label: 'General aggregate limit', severity: 'required', present: (c) => c.submission.coverage?.aggregateLimit != null },
  { key: 'exposures', label: 'Rating exposure (payroll or sales)', severity: 'required', present: (c) => (c.submission.exposures?.length ?? 0) > 0 },
  { key: 'lossHistory', label: '3 years of loss runs', severity: 'required', present: (c) => (c.submission.lossHistory?.length ?? 0) >= 3 },
  { key: 'coverage.deductible', label: 'Deductible', severity: 'recommended', present: (c) => c.submission.coverage?.deductible != null },
  { key: 'insured.classCodes', label: 'GL class code', severity: 'recommended', present: (c) => (c.submission.insured?.classCodes?.length ?? 0) > 0 },
]

/** Compute the gap list against the GL required-fields checklist. Deterministic. */
export function findGaps(caseFile: CaseFile): Gap[] {
  return REQUIRED_FIELDS.filter((f) => !f.present(caseFile)).map((f) => ({
    field: f.key,
    severity: f.severity,
    note: f.label,
  }))
}

export interface AppetiteEvaluation {
  decision: 'in' | 'out' | 'refer'
  score: number
  rules: RuleEvaluation[]
  knockouts: string[]
}

/** Evaluate the appetite ruleset. Deterministic — the decision and score are not LLM-derived. */
export function evaluateAppetite(caseFile: CaseFile): AppetiteEvaluation {
  const rules: RuleEvaluation[] = []
  const knockouts: string[] = []
  let score = 0.85

  const naics = caseFile.submission.insured?.naics ?? ''
  const classCodes = caseFile.submission.insured?.classCodes ?? []
  const prohibited =
    PROHIBITED_NAICS.has(naics) ||
    classCodes.some((c) => PROHIBITED_CLASS_CODES.has(c))
  rules.push({
    ruleId: 'APP-CLASS-01',
    description: 'Class of business within appetite',
    outcome: prohibited ? 'fail' : 'pass',
    detail: prohibited
      ? `Class (${naics || classCodes.join(', ')}) is on the prohibited list (demolition / high-hazard).`
      : 'Class is within the standard GL appetite.',
    guidelineRef: 'GL-MANUAL §2.1 Eligible Classes',
  })
  if (prohibited) {
    knockouts.push('Prohibited class of business')
    score -= 0.5
  }

  // Loss experience.
  const loss = caseFile.submission.lossHistory ?? []
  const totalIncurred = loss.reduce((s, y) => s + y.incurred, 0)
  const totalClaims = loss.reduce((s, y) => s + y.claims, 0)
  const heavyLosses = totalIncurred > 500_000
  const hasOpen = loss.some((y) => (y.notes ?? '').toLowerCase().includes('open'))
  rules.push({
    ruleId: 'APP-LOSS-01',
    description: '3-year incurred losses within tolerance',
    outcome: heavyLosses || hasOpen ? 'refer' : 'pass',
    detail: `${totalClaims} claims / $${totalIncurred.toLocaleString()} incurred over ${loss.length} years.${hasOpen ? ' Open claim in litigation.' : ''}`,
    guidelineRef: 'GL-MANUAL §4.3 Loss Experience',
  })
  if (heavyLosses) score -= 0.2
  if (hasOpen) score -= 0.1

  // Over-authority limit.
  const occ = caseFile.submission.coverage?.occurrenceLimit ?? 0
  const overAuthority = occ > BIND_AUTHORITY_OCCURRENCE
  rules.push({
    ruleId: 'APP-AUTH-01',
    description: 'Requested limit within bind authority',
    outcome: overAuthority ? 'refer' : 'pass',
    detail: overAuthority
      ? `Requested $${occ.toLocaleString()} occurrence exceeds the $${BIND_AUTHORITY_OCCURRENCE.toLocaleString()} automated authority.`
      : `Requested $${occ.toLocaleString()} occurrence is within authority.`,
    guidelineRef: 'GL-MANUAL §1.4 Binding Authority',
  })
  if (overAuthority) score -= 0.1

  // Tenure.
  const years = caseFile.submission.insured?.yearsInBusiness ?? null
  const newVenture = years != null && years < 3
  rules.push({
    ruleId: 'APP-TENURE-01',
    description: 'Operating history of 3+ years',
    outcome: newVenture ? 'refer' : 'pass',
    detail: years == null ? 'Years in business not disclosed.' : `${years} years in business.`,
    guidelineRef: 'GL-MANUAL §3.2 New Ventures',
  })
  if (newVenture) score -= 0.1

  // Completeness.
  const gaps = findGaps(caseFile).filter((g) => g.severity === 'required')
  rules.push({
    ruleId: 'APP-COMPLETE-01',
    description: 'Submission complete enough to rate',
    outcome: gaps.length > 0 ? 'refer' : 'pass',
    detail: gaps.length > 0 ? `${gaps.length} required field(s) missing.` : 'All required fields present.',
    guidelineRef: 'GL-MANUAL §1.1 Submission Requirements',
  })
  if (gaps.length > 0) score -= 0.15

  score = Math.max(0, Math.min(1, score))

  let decision: AppetiteEvaluation['decision'] = 'in'
  if (knockouts.length > 0) decision = 'out'
  else if (rules.some((r) => r.outcome === 'refer')) decision = 'refer'

  return { decision, score, rules, knockouts }
}
