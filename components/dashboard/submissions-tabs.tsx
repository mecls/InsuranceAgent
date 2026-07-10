'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Download, FileText, FileSpreadsheet } from 'lucide-react'
import { StatusChip, displayStatus } from '@/components/ui/status-chip'
import { cn } from '@/lib/utils'

export interface RunSummary {
  id: string
  slug: string
  label: string
  status: string
  sent: boolean
  customer: string | null
  createdAt: string
  readyAt: string | null
}

type Tab = 'all' | 'sent' | 'downloads'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Todos os casos' },
  { id: 'sent', label: 'Enviados' },
  { id: 'downloads', label: 'Descargas' },
]

export function SubmissionsTabs({ runs }: { runs: RunSummary[] }) {
  const [tab, setTab] = useState<Tab>('all')
  const sent = runs.filter((r) => r.sent)

  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('tab', tab === t.id && 'tab-active')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'all' &&
        (runs.length === 0 ? (
          <Empty message="Ainda não há casos. Abra um acima ou lance uma demonstração." />
        ) : (
          <div className="card overflow-hidden px-6">
            {runs.map((r) => (
              <SubmissionRow key={r.id} run={r} />
            ))}
          </div>
        ))}

      {tab === 'sent' &&
        (sent.length === 0 ? (
          <Empty message="Ainda não há orçamentos enviados." />
        ) : (
          <div className="card overflow-hidden px-6">
            {sent.map((r) => (
              <SubmissionRow key={r.id} run={r} showSent />
            ))}
          </div>
        ))}

      {tab === 'downloads' &&
        (sent.length === 0 ? (
          <Empty icon message="Sem descargas. Os orçamentos enviados aparecem aqui em PDF." />
        ) : (
          <div className="card overflow-hidden px-6">
            {sent.map((r) => (
              <DownloadRow key={r.id} run={r} />
            ))}
          </div>
        ))}
    </div>
  )
}

function SubmissionRow({ run, showSent }: { run: RunSummary; showSent?: boolean }) {
  const name = run.label || 'Caso de orçamento'
  return (
    <div className="relative flex items-center gap-4 border-b border-[#F3F4F6] py-3.5 transition-colors last:border-0 hover:bg-[#F9FAFB]">
      <Link href={`/dashboard/runs/${run.slug}`} className="absolute inset-0" aria-label={`Abrir ${name}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{name}</div>
        {run.customer && <div className="truncate text-xs text-[var(--color-text-muted)]">{run.customer}</div>}
      </div>
      <div className="hidden shrink-0 text-xs text-[var(--color-text-placeholder)] tabular sm:block">
        {fmtDate(run.readyAt ?? run.createdAt)}
      </div>
      <StatusChip status={displayStatus(run.status, run.sent)} className="shrink-0" />
      {showSent && (
        <a
          href={`/api/runs/${run.id}/quote-pdf`}
          download
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 grid size-7 place-items-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-brand-light)] hover:text-[var(--color-brand)]"
          aria-label="Descarregar orçamento"
          title="Descarregar orçamento"
        >
          <Download className="size-4" />
        </a>
      )}
      <ArrowRight className="size-4 shrink-0 text-[var(--color-text-placeholder)]" />
    </div>
  )
}

function DownloadRow({ run }: { run: RunSummary }) {
  const name = run.label || 'Caso de orçamento'
  return (
    <div className="flex items-center gap-3 border-b border-[#F3F4F6] py-3.5 last:border-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
        <FileText className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{name} — Orçamento.pdf</div>
        {run.customer && <div className="truncate text-xs text-[var(--color-text-muted)]">{run.customer}</div>}
      </div>
      <div className="hidden shrink-0 text-xs text-[var(--color-text-placeholder)] tabular sm:block">
        {fmtDate(run.readyAt ?? run.createdAt)}
      </div>
      <a href={`/api/runs/${run.id}/quote-pdf`} download className="btn-secondary shrink-0">
        <Download className="size-4" /> Descarregar
      </a>
    </div>
  )
}

function Empty({ message, icon }: { message: string; icon?: boolean }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <FileSpreadsheet className="size-8 text-[var(--color-border)]" strokeWidth={1.5} />}
      <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{message}</p>
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-PT', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
