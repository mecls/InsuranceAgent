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
  insuredName: string | null
  brokerName: string | null
  status: string
  bound: boolean
  policyNumber: string | null
  createdAt: string
  readyAt: string | null
}

type Tab = 'all' | 'bound' | 'downloads'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All Submissions' },
  { id: 'bound', label: 'Bound Policies' },
  { id: 'downloads', label: 'Downloads' },
]

export function SubmissionsTabs({ runs }: { runs: RunSummary[] }) {
  const [tab, setTab] = useState<Tab>('all')
  const bound = runs.filter((r) => r.bound)
  // A quote PDF is available once the run reaches a quote-ready (or bound) state.
  const downloadable = runs.filter((r) => r.status === 'ready' || r.bound)

  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('tab', tab === t.id && 'tab-active')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'all' &&
        (runs.length === 0 ? (
          <Empty message="No submissions yet. Upload one above to get started." />
        ) : (
          <div className="card overflow-hidden px-6">
            {runs.map((r) => (
              <SubmissionRow key={r.id} run={r} />
            ))}
          </div>
        ))}

      {tab === 'bound' &&
        (bound.length === 0 ? (
          <Empty message="No bound policies yet. Bound submissions appear here." />
        ) : (
          <div className="card overflow-hidden px-6">
            {bound.map((r) => (
              <SubmissionRow key={r.id} run={r} showPolicy />
            ))}
          </div>
        ))}

      {tab === 'downloads' &&
        (downloadable.length === 0 ? (
          <Empty
            icon
            message="No downloads yet. Quotes appear here once a submission reaches Quote Ready status."
          />
        ) : (
          <div className="card overflow-hidden px-6">
            {downloadable.map((r) => (
              <DownloadRow key={r.id} run={r} />
            ))}
          </div>
        ))}
    </div>
  )
}

function SubmissionRow({ run, showPolicy }: { run: RunSummary; showPolicy?: boolean }) {
  const name = run.insuredName || run.label || 'Uploaded GL submission'
  return (
    <div className="relative flex items-center gap-4 border-b border-[#F3F4F6] py-3.5 transition-colors last:border-0 hover:bg-[#F9FAFB]">
      <Link
        href={`/dashboard/runs/${run.slug}`}
        className="absolute inset-0"
        aria-label={`Open ${name}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">{name}</div>
        {run.brokerName && (
          <div className="truncate text-xs text-[var(--color-text-muted)]">{run.brokerName}</div>
        )}
      </div>
      <div className="hidden shrink-0 text-xs text-[var(--color-text-placeholder)] tabular sm:block">
        {fmtDate(run.readyAt ?? run.createdAt)}
      </div>
      <StatusChip status={displayStatus(run.status, run.bound)} className="shrink-0" />
      {showPolicy && run.policyNumber && (
        <span className="hidden shrink-0 font-mono text-xs text-[var(--color-text-secondary)] sm:block">
          {run.policyNumber}
        </span>
      )}
      {showPolicy && (
        <a
          href={`/api/runs/${run.id}/quote-pdf`}
          download
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 grid size-7 place-items-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-brand-light)] hover:text-[var(--color-brand)]"
          aria-label="Download quote PDF"
          title="Download quote PDF"
        >
          <Download className="size-4" />
        </a>
      )}
      <ArrowRight className="size-4 shrink-0 text-[var(--color-text-placeholder)]" />
    </div>
  )
}

function DownloadRow({ run }: { run: RunSummary }) {
  const name = run.insuredName || run.label || 'Uploaded GL submission'
  return (
    <div className="flex items-center gap-3 border-b border-[#F3F4F6] py-3.5 last:border-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--color-danger-bg)] text-[var(--color-danger)]">
        <FileText className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {name} — GL Quote.pdf
        </div>
        <div className="truncate text-xs text-[var(--color-text-muted)]">
          {name}
          {run.policyNumber && (
            <>
              {' · '}
              <span className="font-mono">{run.policyNumber}</span>
            </>
          )}
        </div>
      </div>
      <div className="hidden shrink-0 text-xs text-[var(--color-text-placeholder)] tabular sm:block">
        {fmtDate(run.readyAt ?? run.createdAt)}
      </div>
      <a href={`/api/runs/${run.id}/quote-pdf`} download className="btn-secondary shrink-0">
        <Download className="size-4" />
        Download
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
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
