import { z } from 'zod'

/**
 * Extraction output schema (Zod for code validation + JSON Schema for the
 * Anthropic tool input). Both describe the same shape — keep them in sync. The
 * extraction agent reads the submission documents and emits this; the orchestrator
 * folds it into the Case File.
 *
 * Every scalar is nullable: a missing value must come back as null (caught later
 * by the gap check), never fabricated.
 */

const SourceSchema = z.object({
  file: z.string(),
  page: z.number().int().positive().nullable().optional(),
  cell: z.string().nullable().optional(),
})

export const ExtractedFieldSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
  source: SourceSchema,
})

const LossRunYearSchema = z.object({
  year: z.number().int(),
  claims: z.number().int().min(0),
  incurred: z.number().min(0),
  notes: z.string().nullable().optional(),
})

const ExposureSchema = z.object({
  basis: z.string(),
  amount: z.number(),
  classCode: z.string().nullable().optional(),
})

export const ExtractionResultSchema = z.object({
  insured: z.object({
    name: z.string().nullable(),
    fein: z.string().nullable(),
    naics: z.string().nullable(),
    classCodes: z.array(z.string()),
    address: z.string().nullable(),
    yearsInBusiness: z.number().int().nullable(),
  }),
  coverage: z.object({
    occurrenceLimit: z.number().nullable(),
    aggregateLimit: z.number().nullable(),
    deductible: z.number().nullable(),
    requestedEffectiveDate: z.string().nullable(),
  }),
  exposures: z.array(ExposureSchema),
  lossHistory: z.array(LossRunYearSchema),
  fields: z.array(ExtractedFieldSchema),
})

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>

// ── JSON Schema (Anthropic tool input) ──────────────────────────────────────

const SOURCE_JSON = {
  type: 'object',
  additionalProperties: false,
  required: ['file'],
  properties: {
    file: { type: 'string', description: 'Filename the value came from.' },
    page: {
      type: ['integer', 'null'],
      description: 'PDF page number, if applicable.',
    },
    cell: {
      type: ['string', 'null'],
      description: 'Spreadsheet cell reference, if applicable.',
    },
  },
} as const

export const EXTRACTION_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insured', 'coverage', 'exposures', 'lossHistory', 'fields'],
  properties: {
    insured: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'fein', 'naics', 'classCodes', 'address', 'yearsInBusiness'],
      properties: {
        name: { type: ['string', 'null'] },
        fein: { type: ['string', 'null'], description: 'Federal Employer ID Number.' },
        naics: { type: ['string', 'null'], description: 'NAICS industry code.' },
        classCodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'GL class codes (e.g. ISO/NCCI) if stated.',
        },
        address: { type: ['string', 'null'] },
        yearsInBusiness: { type: ['integer', 'null'] },
      },
    },
    coverage: {
      type: 'object',
      additionalProperties: false,
      required: [
        'occurrenceLimit',
        'aggregateLimit',
        'deductible',
        'requestedEffectiveDate',
      ],
      properties: {
        occurrenceLimit: {
          type: ['number', 'null'],
          description: 'Requested per-occurrence limit in dollars.',
        },
        aggregateLimit: {
          type: ['number', 'null'],
          description: 'Requested general aggregate limit in dollars.',
        },
        deductible: { type: ['number', 'null'] },
        requestedEffectiveDate: {
          type: ['string', 'null'],
          description: 'ISO date if stated.',
        },
      },
    },
    exposures: {
      type: 'array',
      description: 'Rating exposures (e.g. payroll, sales, square footage).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['basis', 'amount'],
        properties: {
          basis: {
            type: 'string',
            description: 'Exposure basis, e.g. "gross sales", "payroll".',
          },
          amount: { type: 'number' },
          classCode: { type: ['string', 'null'] },
        },
      },
    },
    lossHistory: {
      type: 'array',
      description: 'Prior loss-run history, one entry per policy year.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['year', 'claims', 'incurred'],
        properties: {
          year: { type: 'integer' },
          claims: { type: 'integer', minimum: 0 },
          incurred: { type: 'number', minimum: 0, description: 'Total incurred in dollars.' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    fields: {
      type: 'array',
      description:
        'Flat list of every extracted field with confidence and source pointer. Include at least the key submission fields.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'confidence', 'source'],
        properties: {
          key: {
            type: 'string',
            description: 'Dotted key, e.g. "insured.name", "coverage.occurrenceLimit".',
          },
          value: { type: ['string', 'number', 'null'] },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Honest extraction confidence.',
          },
          source: SOURCE_JSON,
        },
      },
    },
  },
} as const

// ── Research / Enrichment ────────────────────────────────────────────────────

export const ResearchResultSchema = z.object({
  dossier: z.string(),
  citations: z.array(
    z.object({
      claim: z.string(),
      url: z.string(),
      title: z.string().nullable().optional(),
    }),
  ),
  signals: z.array(
    z.object({
      polarity: z.enum(['positive', 'negative']),
      text: z.string(),
      citationIndex: z.number().int().nullable().optional(),
    }),
  ),
})

export type ResearchResult = z.infer<typeof ResearchResultSchema>

// ── Broker clarification email (Gap agent) ───────────────────────────────────

export const BrokerEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
})
export type BrokerEmail = z.infer<typeof BrokerEmailSchema>

export const BROKER_EMAIL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string', description: 'Concise email subject line.' },
    body: {
      type: 'string',
      description:
        'Polite, specific clarification request listing exactly the missing items. Plain text, signed from the underwriting desk.',
    },
  },
} as const

// ── Appetite rationale (Appetite agent writes prose; decision is deterministic) ─

export const AppetiteRationaleSchema = z.object({
  reasons: z.array(z.string()),
  knockoutExplanations: z.array(z.string()),
})
export type AppetiteRationale = z.infer<typeof AppetiteRationaleSchema>

export const APPETITE_RATIONALE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reasons', 'knockoutExplanations'],
  properties: {
    reasons: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Plain-English bullet reasons for the decision, each citing a rule id (e.g. APP-LOSS-01) and a guideline section.',
    },
    knockoutExplanations: {
      type: 'array',
      items: { type: 'string' },
      description: 'For any knockout, a one-line explanation. Empty if none.',
    },
  },
} as const

// ── Quote assembly (Pricing agent; premium math is deterministic) ────────────

export const QuoteAssemblySchema = z.object({
  summary: z.string(),
  preBindChecklist: z.array(z.string()),
})
export type QuoteAssembly = z.infer<typeof QuoteAssemblySchema>

export const QUOTE_ASSEMBLY_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'preBindChecklist'],
  properties: {
    summary: {
      type: 'string',
      description: 'One-paragraph quote summary for the underwriter. Do NOT restate or recompute the premium math.',
    },
    preBindChecklist: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete pre-bind items (signed application, subjectivities, COIs, etc.).',
    },
  },
} as const

// ── Compliance verdict (Compliance agent) ────────────────────────────────────

export const ComplianceResultSchema = z.object({
  compliance: z.enum(['pass', 'flag']),
  flags: z.array(z.string()),
  summary: z.string(),
})
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>

export const COMPLIANCE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['compliance', 'flags', 'summary'],
  properties: {
    compliance: { type: 'string', enum: ['pass', 'flag'] },
    flags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything requiring disclosure, a fairness concern, or a documentation gap. Empty if clean.',
    },
    summary: {
      type: 'string',
      description: 'A short audit-trail summary: that every field traces to a source and every decision to a rationale.',
    },
  },
} as const

export const RESEARCH_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dossier', 'citations', 'signals'],
  properties: {
    dossier: {
      type: 'string',
      description: 'A sourced risk narrative for the underwriter (2–4 short paragraphs).',
    },
    citations: {
      type: 'array',
      description: 'Sources backing the dossier and signals.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'url'],
        properties: {
          claim: { type: 'string', description: 'What this source supports.' },
          url: { type: 'string' },
          title: { type: ['string', 'null'] },
        },
      },
    },
    signals: {
      type: 'array',
      description: 'Discrete positive/negative risk signals, each tied to a citation where possible.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['polarity', 'text'],
        properties: {
          polarity: { type: 'string', enum: ['positive', 'negative'] },
          text: { type: 'string' },
          citationIndex: {
            type: ['integer', 'null'],
            description: 'Index into the citations array, if this signal is sourced.',
          },
        },
      },
    },
  },
} as const
