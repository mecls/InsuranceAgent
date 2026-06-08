/**
 * DataFeeds — paid third-party enrichment (firmographics, property/cat, industry
 * loss trends). MOCKED for the demo behind this interface, returning canned but
 * realistic responses. Production swaps in live feeds (e.g. firmographics
 * vendors, ISO loss-cost data) without touching agent logic. Responses are
 * deterministic per insured name so runs are reproducible.
 */

export interface Firmographics {
  legalName: string
  estimatedEmployees: number
  estimatedRevenueUsd: number
  yearsInBusiness: number
  website?: string
  source: 'mock_firmographics_feed'
}

export interface IndustryLossTrend {
  naics: string
  trendDirection: 'improving' | 'stable' | 'deteriorating'
  commentary: string
  source: 'mock_industry_loss_feed'
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function getFirmographics(insuredName: string): Firmographics {
  const h = hash(insuredName)
  return {
    legalName: insuredName,
    estimatedEmployees: 20 + (h % 80),
    estimatedRevenueUsd: 2_000_000 + (h % 15) * 1_000_000,
    yearsInBusiness: 4 + (h % 20),
    website: undefined,
    source: 'mock_firmographics_feed',
  }
}

export function getIndustryLossTrend(naics: string | null | undefined): IndustryLossTrend {
  const code = naics ?? '000000'
  // A few representative GL classes; everything else is "stable".
  const map: Record<string, IndustryLossTrend['trendDirection']> = {
    '238910': 'deteriorating', // site prep / demolition
    '488510': 'stable', // freight arrangement
    '722320': 'deteriorating', // caterers (liquor exposure)
  }
  const dir = map[code] ?? 'stable'
  const commentary =
    dir === 'deteriorating'
      ? 'Severity trending up over the trailing 3 years; courts awarding larger bodily-injury verdicts in this class.'
      : 'Frequency and severity broadly flat over the trailing 3 years.'
  return { naics: code, trendDirection: dir, commentary, source: 'mock_industry_loss_feed' }
}
