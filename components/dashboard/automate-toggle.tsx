'use client'

import { useState, useTransition } from 'react'
import { Zap } from 'lucide-react'
import { toggleAutomate } from '@/app/actions/runs'
import { cn } from '@/lib/utils'

/**
 * Global Automate switch. When ON, incoming cases run end-to-end and the quote
 * auto-sends; when OFF, they land as drafts the user reviews and starts.
 */
export function AutomateToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [, startTransition] = useTransition()

  const flip = () => {
    const next = !on
    setOn(next)
    startTransition(() => {
      void toggleAutomate(next)
    })
  }

  return (
    <div className="card flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className={cn('grid size-9 place-items-center rounded-lg', on ? 'bg-[var(--color-brand-light)] text-[var(--color-brand)]' : 'bg-neutral-100 text-neutral-500')}>
          <Zap className="size-4" />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">Modo Automatizar</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {on
              ? 'Os pedidos são orçamentados e enviados automaticamente, sem revisão.'
              : 'Os pedidos aguardam a sua revisão antes de enviar o orçamento.'}
          </div>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={flip}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-[var(--color-brand)]' : 'bg-neutral-300')}
      >
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  )
}
