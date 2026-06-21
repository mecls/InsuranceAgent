import type { CaseFile, RatingLineItem } from '@/lib/underwriting/case-file'

/**
 * RatingEngine — SIMULATED. This is the explicit production integration point:
 * representative rate tables and modifiers behind a clean interface, to be
 * swapped for the carrier's rating engine. Fully DETERMINISTIC (the LLM never
 * does pricing math). Labelled as simulated on screen.
 */

// Base GL rate per $1,000 of exposure, by a coarse hazard tier derived from NAICS.
const HAZARD_TIER: Record<string, number> = {
  '488510': 3.2, // freight arrangement — lower hazard
  '722320': 9.5, // caterers — moderate (premises + liquor)
  '238910': 22.0, // demolition — high hazard
}
const DEFAULT_RATE = 6.0

export interface RatingResult {
  premium: number
  currency: string
  breakdown: RatingLineItem[]
  /**
   * True only when the engine had the inputs a real rate needs (a stated rating
   * exposure). False means the premium is a placeholder built on an assumed
   * exposure and must NOT be presented as a firm indication.
   */
  ratable: boolean
  /** Assumptions the engine had to make because inputs were missing. */
  assumptions: string[]
}

const PLACEHOLDER_EXPOSURE = 1_000_000

export function rate(caseFile: CaseFile): RatingResult {
  const naics = caseFile.submission.insured?.naics ?? ''
  const baseRate = HAZARD_TIER[naics] ?? DEFAULT_RATE
  const assumptions: string[] = []

  // Exposure basis: sum of stated exposures. With none on file we CANNOT produce
  // a real rate — fall back to a labelled placeholder and mark the result as not
  // ratable, rather than emitting a confident but fictional premium.
  const exposures = caseFile.submission.exposures ?? []
  const statedExposure = exposures.reduce((s, e) => s + (e.amount || 0), 0)
  const hasExposure = statedExposure > 0
  const exposureAmount = hasExposure ? statedExposure : PLACEHOLDER_EXPOSURE
  if (!hasExposure) {
    assumptions.push(
      `No rating exposure (sales or payroll) on file; base premium uses a $${PLACEHOLDER_EXPOSURE.toLocaleString()} placeholder and is NOT a real rate.`,
    )
  }
  if (!naics) {
    assumptions.push(`No NAICS on file; using the default GL rate $${DEFAULT_RATE.toFixed(2)} / $1K.`)
  }

  const breakdown: RatingLineItem[] = []

  const basePremium = (exposureAmount / 1000) * baseRate
  breakdown.push({
    label: `Base premium (${naics || 'default'} @ $${baseRate.toFixed(2)} / $1K exposure)`,
    kind: 'base',
    value: round(basePremium),
    detail: `Exposure basis $${exposureAmount.toLocaleString()}.`,
  })

  // Experience modifier from 3-year loss ratio proxy.
  const loss = caseFile.submission.lossHistory ?? []
  const incurred = loss.reduce((s, y) => s + y.incurred, 0)
  const lossRatio = incurred / Math.max(basePremium * Math.max(loss.length, 1), 1)
  const expMod = clamp(0.85 + lossRatio * 0.5, 0.85, 1.75)
  breakdown.push({
    label: 'Experience modifier',
    kind: 'modifier',
    value: round2(expMod),
    detail: `3-yr incurred $${incurred.toLocaleString()}; loss-ratio proxy ${(lossRatio * 100).toFixed(0)}%.`,
  })

  // Protection / risk-control modifier (placeholder: subcontractor + tenure signal).
  const years = caseFile.submission.insured?.yearsInBusiness ?? 5
  const tenureMod = years >= 10 ? 0.95 : years >= 3 ? 1.0 : 1.1
  breakdown.push({
    label: 'Tenure / risk-control modifier',
    kind: 'modifier',
    value: round2(tenureMod),
    detail: `${years} years in business.`,
  })

  let premium = basePremium * expMod * tenureMod

  // Policy fee.
  const fee = 250
  breakdown.push({ label: 'Policy fee', kind: 'fee', value: fee })
  premium += fee

  return {
    premium: round(premium),
    currency: 'USD',
    breakdown,
    ratable: hasExposure,
    assumptions,
  }
}

function round(n: number): number {
  return Math.round(n)
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
