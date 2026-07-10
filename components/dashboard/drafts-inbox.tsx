'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Play, Inbox } from 'lucide-react'
import { startRun } from '@/app/actions/runs'

export interface DraftSummary {
  id: string
  slug: string
  summary: string
  channel: string
  customer: string | null
}

/**
 * Caixa de entrada — cases parsed from an inbound request (WhatsApp/email) that
 * are waiting to be started (Automate OFF). "Iniciar" enqueues the workflow.
 */
export function DraftsInbox({ drafts }: { drafts: DraftSummary[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-6 py-3 text-sm font-semibold text-[var(--color-text-primary)]">
        <Inbox className="size-4 text-[var(--color-brand)]" /> Caixa de entrada
        {drafts.length > 0 && (
          <span className="chip ml-1" style={{ background: 'var(--color-brand-light)', color: 'var(--color-brand)' }}>{drafts.length}</span>
        )}
      </div>
      {drafts.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
          Sem pedidos novos. Os pedidos recebidos por WhatsApp e email entram aqui automaticamente.
        </div>
      ) : (
        <div className="px-6">
          {drafts.map((d) => (
            <DraftRow key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DraftRow({ draft }: { draft: DraftSummary }) {
  const [pending, setPending] = useState(false)
  const start = async () => {
    setPending(true)
    try {
      await startRun(draft.id)
    } catch {
      setPending(false)
    }
  }
  const channelLabel = draft.channel === 'whatsapp' ? 'WhatsApp' : draft.channel === 'email' ? 'Email' : 'Formulário'
  return (
    <div className="flex items-center gap-4 border-b border-[#F3F4F6] py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{draft.summary || 'Novo pedido'}</div>
        <div className="truncate text-xs text-[var(--color-text-muted)]">
          {draft.customer ?? 'Cliente'} · {channelLabel}
        </div>
      </div>
      <Link href={`/dashboard/runs/${draft.slug}`} className="btn-ghost shrink-0">Ver</Link>
      <button onClick={start} disabled={pending} className="btn-primary shrink-0">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5" />}
        Iniciar
      </button>
    </div>
  )
}
