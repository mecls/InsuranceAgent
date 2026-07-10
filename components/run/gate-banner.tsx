'use client'

import { Clock, UserCheck } from 'lucide-react'
import type { NodeState } from '@/lib/run-state'

/**
 * Inline banner for the two gates. `customer` (await-customer) shows the agent is
 * waiting on / chasing the customer; `review` prompts the user to approve the
 * quote in the Orçamento view.
 */
export function GateBanner({
  node,
  variant,
}: {
  node: NodeState
  variant: 'customer' | 'review'
}) {
  if (variant === 'customer') {
    return (
      <Bar
        icon={<Clock className="size-4" />}
        title="A aguardar o cliente"
        detail={node.activity ?? 'A aguardar a resposta do cliente. A perseguir automaticamente se não responder.'}
      />
    )
  }
  return (
    <Bar
      icon={<UserCheck className="size-4" />}
      title="Orçamento pronto — reveja e aprove"
      detail="Reveja o orçamento no separador Orçamento e aprove para enviar ao cliente."
    />
  )
}

function Bar({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-900">{title}</div>
          <div className="mt-0.5 text-xs text-amber-700">{detail}</div>
        </div>
      </div>
    </div>
  )
}
