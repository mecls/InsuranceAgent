/**
 * The agent crew as graph nodes. Order is the left-to-right pipeline shown on
 * the dashboard. Node ids are the single source of truth shared by the
 * orchestrator (which emits events keyed by nodeId), the event model, and the
 * React Flow canvas.
 */

export const NODE_IDS = [
  'intake',
  'extraction',
  'gap',
  'research',
  'appetite',
  'pricing',
  'compliance',
] as const

export type NodeId = (typeof NODE_IDS)[number]

export interface NodeDef {
  id: NodeId
  label: string
  /** Short description shown in the node card / detail panel header. */
  blurb: string
  /** Whether this phase performs real work or is simulated for the demo. */
  mode: 'real' | 'sim' | 'gated'
}

export const NODES: NodeDef[] = [
  {
    id: 'intake',
    label: 'Intake',
    blurb: 'Parse the broker email, inventory and classify attachments.',
    mode: 'real',
  },
  {
    id: 'extraction',
    label: 'Extraction',
    blurb: 'Read ACORD / supplemental PDFs and the loss-run workbook into a structured Case File.',
    mode: 'real',
  },
  {
    id: 'gap',
    label: 'Gap & Broker Comms',
    blurb: 'Validate completeness vs. the GL checklist; draft a clarification email (send is gated).',
    mode: 'gated',
  },
  {
    id: 'research',
    label: 'Research & Enrichment',
    blurb: 'Enrich the applicant from live public sources; produce a sourced risk dossier.',
    mode: 'real',
  },
  {
    id: 'appetite',
    label: 'Appetite & Risk',
    blurb: 'Score against the carrier appetite rules and GL underwriting guidelines.',
    mode: 'real',
  },
  {
    id: 'pricing',
    label: 'Pricing & Quote',
    blurb: 'Rate the risk (simulated engine) and assemble the quote + pre-bind checklist.',
    mode: 'sim',
  },
  {
    id: 'compliance',
    label: 'Compliance & Audit',
    blurb: 'Assemble the audit trail from the event log; flag anything requiring disclosure.',
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
  { source: 'intake', target: 'extraction' },
  { source: 'extraction', target: 'gap' },
  { source: 'gap', target: 'research' },
  { source: 'research', target: 'appetite' },
  { source: 'appetite', target: 'pricing' },
  { source: 'pricing', target: 'compliance' },
]
