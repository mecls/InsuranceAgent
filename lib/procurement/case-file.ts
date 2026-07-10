/**
 * The Case File — the single typed object threaded through the graph. Each node
 * writes its slice; it is persisted on `runs.case_file` (jsonb) and accumulates
 * as the run progresses. Shapes are intentionally permissive (most optional)
 * because the file is built up node by node.
 *
 * This is a VENDOR quoting workflow: a customer asks the business for a price;
 * the agent clarifies the missing details with the customer (and chases), prices
 * from the business's own catálogo, drafts the orçamento, and sends it. The
 * business produces ONE quote for the customer (no fornecedores, no comparison).
 */

/** The vendor's line of business (drives which catálogo items are relevant). */
export type Vertical = 'obra' | 'remodelacao' | 'canalizacao' | 'limpeza' | 'generico'

export type CaseStatus =
  | 'rascunho' // parsed draft, not started
  | 'recebido' // intake done
  | 'a_esclarecer' // questions drafted
  | 'a_aguardar' // waiting on the customer
  | 'a_orcamentar' // pricing
  | 'redigido' // quote drafted
  | 'em_revisao' // awaiting the user's review
  | 'enviado' // quote sent to the customer
  | 'fechado' // closed without a quote

export type CustomerChannel = 'whatsapp' | 'email' | 'form'

export interface Customer {
  name?: string
  channel: CustomerChannel
  /** Phone (whatsapp) or email address. */
  contact?: string
  threadId?: string
}

/** One question asked of the customer and (once received) its answer. */
export interface Clarification {
  question: string
  answer?: string
  askedAt?: string
  answeredAt?: string
}

/** Portuguese VAT rates (6% reduced/empreitadas, 13% intermediate, 23% standard). */
export type IvaRate = 6 | 13 | 23
export type Unit = 'm2' | 'ml' | 'unidade' | 'hora' | 'global'

export interface LineItem {
  catalogItemId?: string | null
  description: string
  unit: Unit
  quantity: number
  /** From the catálogo; null when no catálogo match (flagged for review). */
  unitPrice: number | null
  total: number | null
  ivaRate: IvaRate | null
  source: 'catalog' | 'manual' | 'estimate'
}

export interface Pricing {
  subtotal: number // sum of line totals, sem IVA
  ivaBreakdown: { rate: IvaRate; base: number; amount: number }[]
  ivaAmount: number
  total: number // com IVA
  /** True when any line has no catálogo price (needs human input). */
  hasUnpriced: boolean
}

export interface CaseFile {
  caseId: string
  status: CaseStatus
  vertical: Vertical
  /** Scripted demo run (self-driving customer replies, no real comms). */
  demo: boolean
  /** When true the review gate auto-approves and the quote auto-sends. */
  automate: boolean

  customer: Customer
  request: {
    summary: string
    rawText: string
    category?: string | null
  }

  /** Information still required from the customer before a quote can be priced. */
  needed: string[]
  clarifications: Clarification[]

  lineItems: LineItem[]
  pricing?: Pricing

  quote?: {
    subject: string
    body: string
    prazoExecucao?: string | null
    validade?: string | null
    condicoesPagamento?: string | null
    exclusoes: string[]
  }

  sent?: { at: string; via: CustomerChannel }
  decision?: 'aceite' | 'recusado' | 'pendente'

  source?: {
    type: 'web' | 'whatsapp' | 'email' | 'slack'
    threadId?: string
    channel?: string
    threadTs?: string
  }
  closedWithoutQuote?: boolean
}

export function emptyCaseFile(caseId: string): CaseFile {
  return {
    caseId,
    status: 'rascunho',
    vertical: 'generico',
    demo: false,
    automate: false,
    customer: { channel: 'form' },
    request: { summary: '', rawText: '' },
    needed: [],
    clarifications: [],
    lineItems: [],
  }
}

export function customerLabel(cf: CaseFile): string {
  return cf.customer.name || cf.customer.contact || 'Cliente'
}

/** Clarification questions still awaiting an answer. */
export function openQuestions(cf: CaseFile): Clarification[] {
  return cf.clarifications.filter((c) => !c.answer)
}
