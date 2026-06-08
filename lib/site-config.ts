export const SITE_CONFIG = {
  brand: 'InsuranceAgent',
  description:
    'Agentic underwriting assistant — broker submission to quote-ready file, with a live node-graph of every phase.',
  // Demo line of business. Drives the required-fields checklist, the appetite
  // ruleset, and the research focus.
  lineOfBusiness: 'general_liability' as const,
  lineOfBusinessLabel: 'Commercial General Liability',
  // The cycle-time banner compares the live run against a manual baseline.
  manualBaselineLabel: '~3 days manual',
} as const
