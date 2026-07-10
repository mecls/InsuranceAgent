import { z } from 'zod'

/**
 * Tool-input schemas for the vendor quoting agents. Each pairs a Zod schema (code
 * validation) with a JSON Schema (the LLM tool input). The LLM only ever parses,
 * asks questions, SELECTS catálogo items + quantities, and writes prose. All
 * money — line totals, IVA, grand total — is computed deterministically in
 * pricing.ts. The model never invents prices.
 */

const UNITS = ['m2', 'ml', 'unidade', 'hora', 'global'] as const
const VERTICALS = ['obra', 'remodelacao', 'canalizacao', 'limpeza', 'generico'] as const

// ── Parse request (Receber pedido) ───────────────────────────────────────────

export const ParseRequestSchema = z.object({
  customerName: z.string().nullable(),
  summary: z.string(),
  category: z.string().nullable(),
  vertical: z.enum(VERTICALS),
})
export type ParseRequest = z.infer<typeof ParseRequestSchema>

export const PARSE_REQUEST_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['customerName', 'summary', 'category', 'vertical'],
  properties: {
    customerName: { type: ['string', 'null'], description: 'Nome do cliente, se indicado.' },
    summary: { type: 'string', description: 'Resumo claro do que o cliente pretende orçamentar.' },
    category: { type: ['string', 'null'], description: 'Categoria do trabalho (ex.: "Pintura de fachada").' },
    vertical: { type: 'string', enum: [...VERTICALS], description: 'Setor do trabalho.' },
  },
} as const

// ── Clarify (Esclarecer) ─────────────────────────────────────────────────────

export const ClarifySchema = z.object({
  ready: z.boolean(),
  needed: z.array(z.string()),
  questions: z.array(z.string()),
})
export type Clarify = z.infer<typeof ClarifySchema>

export const CLARIFY_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'needed', 'questions'],
  properties: {
    ready: {
      type: 'boolean',
      description: 'true se o pedido já tem informação suficiente para orçamentar sem perguntar nada.',
    },
    needed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Informação em falta para poder orçamentar (ex.: "área aproximada", "morada", "materiais").',
    },
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'As perguntas concretas a enviar ao cliente, em Português de Portugal. Vazio se ready=true.',
    },
  },
} as const

// ── Line items (Calcular preços) ─────────────────────────────────────────────
// The LLM selects catálogo items + quantities; pricing.ts computes the money.

export const LineItemsSchema = z.object({
  lineItems: z.array(
    z.object({
      catalogItemId: z.string().nullable(),
      description: z.string(),
      unit: z.enum(UNITS),
      quantity: z.number(),
    }),
  ),
  notes: z.array(z.string()),
})
export type LineItemsResult = z.infer<typeof LineItemsSchema>

export const LINE_ITEMS_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lineItems', 'notes'],
  properties: {
    lineItems: {
      type: 'array',
      description: 'Uma linha por trabalho a orçamentar. Escolhe o item do catálogo que melhor corresponde (catalogItemId) ou null se nenhum servir.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['catalogItemId', 'description', 'unit', 'quantity'],
        properties: {
          catalogItemId: {
            type: ['string', 'null'],
            description: 'O id do item do catálogo fornecido, ou null se nenhum corresponder.',
          },
          description: { type: 'string', description: 'Descrição da linha para o orçamento.' },
          unit: { type: 'string', enum: [...UNITS] },
          quantity: { type: 'number', description: 'Quantidade (ex.: m2, unidades, horas). Usa a informação esclarecida; nunca inventes valores irrealistas.' },
        },
      },
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Notas ou pressupostos assumidos (ex.: "área estimada a confirmar"). Vazio se nenhum.',
    },
  },
} as const

// ── Quote document (Redigir orçamento) ───────────────────────────────────────

export const QuoteDocSchema = z.object({
  subject: z.string(),
  body: z.string(),
  prazoExecucao: z.string().nullable(),
  validade: z.string().nullable(),
  condicoesPagamento: z.string().nullable(),
  exclusoes: z.array(z.string()),
})
export type QuoteDoc = z.infer<typeof QuoteDocSchema>

export const QUOTE_DOC_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body', 'prazoExecucao', 'validade', 'condicoesPagamento', 'exclusoes'],
  properties: {
    subject: { type: 'string', description: 'Assunto do orçamento a enviar ao cliente.' },
    body: {
      type: 'string',
      description:
        'Corpo do orçamento em Português de Portugal: saudação, breve descrição do trabalho e próximos passos. NÃO repitas nem recalcules a tabela de preços (é gerada por código). Assina como "Equipa".',
    },
    prazoExecucao: { type: ['string', 'null'], description: 'Prazo de execução proposto (ex.: "3 semanas").' },
    validade: { type: ['string', 'null'], description: 'Validade do orçamento (ex.: "30 dias").' },
    condicoesPagamento: { type: ['string', 'null'], description: 'Condições de pagamento propostas.' },
    exclusoes: { type: 'array', items: { type: 'string' }, description: 'O que não está incluído. Vazio se nenhuma.' },
  },
} as const
