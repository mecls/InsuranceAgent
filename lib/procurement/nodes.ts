/**
 * The vendor quoting crew as graph nodes. Order is the left-to-right pipeline
 * shown on the dashboard. Node ids are the single source of truth shared by the
 * orchestrator (which emits events keyed by nodeId), the event model, and the
 * React Flow canvas.
 *
 * Flow: receber pedido → esclarecer → aguardar cliente → calcular preços →
 * redigir orçamento → rever & aprovar → enviar ao cliente.
 */

export const NODE_IDS = [
  'intake',
  'clarify',
  'await-customer',
  'price',
  'draft-quote',
  'review',
  'send',
] as const

export type NodeId = (typeof NODE_IDS)[number]

export interface NodeDef {
  id: NodeId
  label: string
  blurb: string
  /** real = does real work; gated = parks awaiting the customer/human. */
  mode: 'real' | 'sim' | 'gated'
}

export const NODES: NodeDef[] = [
  {
    id: 'intake',
    label: 'Receber pedido',
    blurb: 'Interpreta o pedido do cliente e abre o caso.',
    mode: 'real',
  },
  {
    id: 'clarify',
    label: 'Esclarecer',
    blurb: 'Deteta a informação em falta e prepara as perguntas ao cliente.',
    mode: 'real',
  },
  {
    id: 'await-customer',
    label: 'Aguardar cliente',
    blurb: 'Envia as perguntas, aguarda a resposta e persegue quem não responde. Sem um único telefonema.',
    mode: 'gated',
  },
  {
    id: 'price',
    label: 'Calcular preços',
    blurb: 'Seleciona os itens do catálogo e calcula quantidades, preços e IVA.',
    mode: 'real',
  },
  {
    id: 'draft-quote',
    label: 'Redigir orçamento',
    blurb: 'Compõe o orçamento para o cliente com prazo, validade e condições.',
    mode: 'real',
  },
  {
    id: 'review',
    label: 'Rever & aprovar',
    blurb: 'O utilizador revê e aprova o orçamento. Automático quando o modo Automatizar está ligado.',
    mode: 'gated',
  },
  {
    id: 'send',
    label: 'Enviar ao cliente',
    blurb: 'Envia o orçamento ao cliente no canal em que este contactou.',
    mode: 'real',
  },
]

export function nodeDef(id: NodeId): NodeDef {
  const def = NODES.find((n) => n.id === id)
  if (!def) throw new Error(`unknown nodeId: ${id}`)
  return def
}

/** Directed edges (data flow) between phases, left to right. */
export const EDGES: { source: NodeId; target: NodeId }[] = [
  { source: 'intake', target: 'clarify' },
  { source: 'clarify', target: 'await-customer' },
  { source: 'await-customer', target: 'price' },
  { source: 'price', target: 'draft-quote' },
  { source: 'draft-quote', target: 'review' },
  { source: 'review', target: 'send' },
]
