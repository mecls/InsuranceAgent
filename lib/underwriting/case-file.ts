/**
 * The Case File — the single typed object threaded through the graph. Each node
 * writes its slice; it is persisted on `runs.case_file` (jsonb) and accumulates
 * as the run progresses. Shapes here are intentionally permissive (most fields
 * optional) because the file is built up node by node.
 *
 * Line of business is fixed to General Liability for the demo.
 */

export type CaseFileStatus =
  | 'intake'
  | 'extracting'
  | 'gap_check'
  | 'researching'
  | 'appetite'
  | 'pricing'
  | 'compliance'
  | 'complete'

/** A single extracted field, carrying confidence + a source pointer. */
export interface ExtractedField {
  key: string
  value: string | number | null
  confidence: number // 0..1
  source: { file: string; page?: number | null; cell?: string | null }
}

export interface AttachmentManifestItem {
  filename: string
  /** Classified document type. */
  kind:
    | 'acord_125'
    | 'acord_126'
    | 'gl_supplemental'
    | 'loss_run'
    | 'sov'
    | 'cover_letter'
    | 'unknown'
  mime: string
  /** Storage path within the `submissions` bucket. */
  storagePath: string
  sizeBytes: number
}

export interface LossRunYear {
  year: number
  claims: number
  incurred: number
  notes?: string | null
}

export interface Gap {
  field: string
  severity: 'required' | 'recommended'
  note?: string
}

export interface Citation {
  claim: string
  url: string
  title?: string
}

export interface RiskSignal {
  polarity: 'positive' | 'negative'
  text: string
  citationIndex?: number
}

export interface RuleEvaluation {
  ruleId: string
  description: string
  outcome: 'pass' | 'fail' | 'refer'
  detail: string
  guidelineRef?: string
}

export interface RatingLineItem {
  label: string
  kind: 'base' | 'modifier' | 'fee'
  /** For modifiers, a multiplier (e.g. 1.15); for base/fees, a currency amount. */
  value: number
  detail?: string
}

export interface CaseFile {
  caseId: string
  status: CaseFileStatus
  lineOfBusiness: 'general_liability'

  submission: {
    broker?: { name?: string; email?: string }
    insured?: {
      name?: string
      fein?: string
      naics?: string
      classCodes?: string[]
      address?: string
      yearsInBusiness?: number
    }
    coverage?: {
      occurrenceLimit?: number
      aggregateLimit?: number
      deductible?: number
      requestedEffectiveDate?: string
    }
    exposures?: { basis: string; amount: number; classCode?: string | null }[]
    lossHistory?: LossRunYear[]
    /** Where this submission came from, when ingested from an external source. */
    source?: { type: 'gmail'; threadId: string; permalink?: string }
  }

  attachments: AttachmentManifestItem[]
  fields: ExtractedField[]
  gaps: Gap[]

  /**
   * Authoritative documents (ACORD, supplemental, SOV) that were supplied but
   * yielded no readable content — i.e. extraction ran blind on them. This is a
   * DIFFERENT, more serious finding than a missing field: it means the data may
   * be present in the file but the agent could not read it. Drives a compliance
   * flag and is shown to the underwriter so missing fields aren't mistaken for
   * "not in the submission". Usually means a vision model is needed (see
   * LLM_VISION_MODEL) for scanned/compressed PDFs.
   */
  unreadableDocuments?: string[]

  brokerEmailDraft?: { subject: string; body: string }

  enrichment?: {
    dossier: string
    signals: RiskSignal[]
    citations: Citation[]
  }

  appetite?: {
    decision: 'in' | 'out' | 'refer'
    score: number // 0..1
    reasons: string[]
    knockouts: string[]
    rules: RuleEvaluation[]
  }

  quote?: {
    premium: number
    currency: string
    summary?: string
    ratingBreakdown: RatingLineItem[]
    preBindChecklist: { item: string; done: boolean }[]
    simulated: true
    /**
     * False when the premium rests on assumed inputs (missing exposure, or an
     * unread document) — a placeholder, not a firm indication. The UI surfaces
     * this so a fictional premium is never shown as reliable.
     */
    reliable?: boolean
    /** Why the premium may be unreliable (missing inputs, unread docs). */
    assumptions?: string[]
  }
  /** Set to true when out of appetite — declined, no quote. */
  declined?: boolean

  audit?: {
    compliance: 'pass' | 'flag'
    flags: string[]
    summary: string
  }
}

/** An empty Case File for a fresh run. */
export function emptyCaseFile(caseId: string): CaseFile {
  return {
    caseId,
    status: 'intake',
    lineOfBusiness: 'general_liability',
    submission: {},
    attachments: [],
    fields: [],
    gaps: [],
  }
}
