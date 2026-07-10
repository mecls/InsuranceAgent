'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { EDGES, NODES, type NodeId } from '@/lib/procurement/nodes'
import type { RunState } from '@/lib/run-state'
import { AgentNode, type AgentNodeData } from './agent-node'

const nodeTypes = { agent: AgentNode }

const COL_GAP = 300
const ROW_Y = 40

interface RunGraphProps {
  state: RunState
  selected: NodeId | null
  onSelect: (id: NodeId) => void
}

export function RunGraph({ state, selected, onSelect }: RunGraphProps) {
  const nodes: Node[] = useMemo(
    () =>
      NODES.map((def, i) => ({
        id: def.id,
        type: 'agent',
        position: { x: i * COL_GAP, y: ROW_Y },
        data: {
          nodeId: def.id,
          label: def.label,
          mode: def.mode,
          node: state.nodes[def.id],
          selected: selected === def.id,
        } satisfies AgentNodeData,
        draggable: false,
      })),
    [state, selected],
  )

  const edges: Edge[] = useMemo(
    () =>
      EDGES.map((e) => {
        const active = state.activeEdges.some(
          (a) => a.source === e.source && a.target === e.target,
        )
        const label = state.activeEdges.find(
          (a) => a.source === e.source && a.target === e.target,
        )?.label
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          animated: active,
          className: active ? 'edge-active' : undefined,
          label: active ? label : undefined,
          labelStyle: { fontSize: 10, fill: 'rgb(27 45 190)' },
          style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
        }
      }),
    [state],
  )

  const handleClick: NodeMouseHandler = (_, node) => {
    onSelect(node.id as NodeId)
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable
      minZoom={0.4}
      maxZoom={1.5}
    >
      <Background gap={20} color="#e7e7e2" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
