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
}

export function rate(caseFile: CaseFile): RatingResult {
  const naics = caseFile.submission.insured?.naics ?? ''
  const baseRate = HAZARD_TIER[naics] ?? DEFAULT_RATE

  // Exposure basis: sum of stated exposures, else a sales/payroll proxy.
  const exposures = caseFile.submission.exposures ?? []
  const exposureAmount =
    exposures.reduce((s, e) => s + (e.amount || 0), 0) || 1_000_000

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

  return { premium: round(premium), currency: 'USD', breakdown }
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
