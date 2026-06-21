'use client'

import { useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { UploadCloud, FileText, Mail, X, Loader2, RotateCcw } from 'lucide-react'
import { startSubmissionRun } from '@/app/actions/runs'
import { GmailPicker, type GmailThreadMeta } from './gmail-picker'
import { cn } from '@/lib/utils'

/**
 * Unified submission composer. A single run is built from any mix of locally
 * uploaded files and documents pulled from connected Gmail threads — both feed one
 * document list and one "Run Submission" action. Importing a thread also hydrates
 * the broker fields and cover note from the email. Posts to `startSubmissionRun`.
 */

interface GmailSource {
  threadId: string
  permalink: string
  subject: string
  from: { name?: string; address?: string }
  attachments: { filename: string; mimeType: string; sizeBytes: number }[]
}

export function NewSubmission() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [gmailSources, setGmailSources] = useState<GmailSource[]>([])
  const [dragging, setDragging] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Broker fields are controlled so importing a Gmail thread can hydrate them.
  const [brokerName, setBrokerName] = useState('')
  const [brokerEmail, setBrokerEmail] = useState('')
  const [insuredName, setInsuredName] = useState('')
  const [coverLetter, setCoverLetter] = useState('')

  // The hidden <input name="files"> is the source of truth the form submits.
  function syncFiles(next: File[]) {
    const dt = new DataTransfer()
    for (const f of next) dt.items.add(f)
    if (inputRef.current) inputRef.current.files = dt.files
    setFiles(next)
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const byKey = new Map(files.map((f) => [`${f.name}:${f.size}`, f]))
    for (const f of Array.from(list)) byKey.set(`${f.name}:${f.size}`, f)
    syncFiles(Array.from(byKey.values()).slice(0, 12))
  }

  function removeFileAt(i: number) {
    syncFiles(files.filter((_, idx) => idx !== i))
  }

  function addGmailSource(meta: GmailThreadMeta) {
    setGmailSources((prev) => {
      if (prev.some((s) => s.threadId === meta.threadId)) return prev
      return [
        ...prev,
        {
          threadId: meta.threadId,
          permalink: meta.permalink,
          subject: meta.subject,
          from: meta.from,
          attachments: meta.attachments,
        },
      ]
    })
    // Hydrate empty broker fields + cover note from the email.
    if (!brokerName && meta.from.name) setBrokerName(meta.from.name)
    if (!brokerEmail && meta.from.address) setBrokerEmail(meta.from.address)
    if (!coverLetter && meta.text) setCoverLetter(meta.text)
  }

  function removeGmailAttachment(threadId: string, filename: string) {
    setGmailSources((prev) =>
      prev
        .map((s) =>
          s.threadId === threadId
            ? { ...s, attachments: s.attachments.filter((a) => a.filename !== filename) }
            : s,
        )
        // Drop a source once it has no documents and no longer feeds the cover note.
        .filter((s) => s.attachments.length > 0),
    )
  }

  function removeGmailSource(threadId: string) {
    setGmailSources((prev) => prev.filter((s) => s.threadId !== threadId))
  }

  function reset() {
    syncFiles([])
    setGmailSources([])
    setBrokerName('')
    setBrokerEmail('')
    setInsuredName('')
    setCoverLetter('')
  }

  // Flattened document list shown under the drop zone (uploads + Gmail docs). Pure
  // data — the remove handlers are wired as JSX event handlers below.
  type DocRow = {
    key: string
    name: string
    size: number
    origin: 'upload' | 'gmail'
    note?: string
  } & (
    | { kind: 'file'; fileIndex: number }
    | { kind: 'gmail-file'; threadId: string; filename: string }
    | { kind: 'gmail-body'; threadId: string }
  )

  const docRows: DocRow[] = []
  files.forEach((f, i) =>
    docRows.push({
      key: `f:${f.name}:${f.size}`,
      name: f.name,
      size: f.size,
      origin: 'upload',
      kind: 'file',
      fileIndex: i,
    }),
  )
  for (const s of gmailSources) {
    if (s.attachments.length === 0) {
      docRows.push({
        key: `g:${s.threadId}:body`,
        name: s.subject,
        size: 0,
        origin: 'gmail',
        note: 'Email body → cover note',
        kind: 'gmail-body',
        threadId: s.threadId,
      })
      continue
    }
    for (const a of s.attachments) {
      docRows.push({
        key: `g:${s.threadId}:${a.filename}`,
        name: a.filename,
        size: a.sizeBytes,
        origin: 'gmail',
        kind: 'gmail-file',
        threadId: s.threadId,
        filename: a.filename,
      })
    }
  }

  function removeRow(r: DocRow) {
    if (r.kind === 'file') removeFileAt(r.fileIndex)
    else if (r.kind === 'gmail-file') removeGmailAttachment(r.threadId, r.filename)
    else removeGmailSource(r.threadId)
  }

  const gmailThreadsJson = JSON.stringify(
    gmailSources.map((s) => ({
      threadId: s.threadId,
      permalink: s.permalink,
      keep: s.attachments.map((a) => a.filename),
    })),
  )

  const hasContent = docRows.length > 0 || coverLetter.trim().length > 0
  const isDirty =
    hasContent ||
    brokerName.trim().length > 0 ||
    brokerEmail.trim().length > 0 ||
    insuredName.trim().length > 0

  return (
    <form action={startSubmissionRun} className="card p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Broker name">
          <input
            name="brokerName"
            value={brokerName}
            onChange={(e) => setBrokerName(e.target.value)}
            placeholder="Dana Whitfield"
            className="input"
          />
        </Field>
        <Field label="Broker email">
          <input
            name="brokerEmail"
            type="email"
            value={brokerEmail}
            onChange={(e) => setBrokerEmail(e.target.value)}
            placeholder="broker@agency.com"
            className="input"
          />
        </Field>
        <Field label="Named insured">
          <input
            name="insuredName"
            value={insuredName}
            onChange={(e) => setInsuredName(e.target.value)}
            placeholder="Acme Logistics LLC"
            className="input"
          />
        </Field>
      </div>

      <Field label="Cover note" className="mt-4">
        <textarea
          name="coverLetter"
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          rows={3}
          placeholder="Paste the broker's cover message — or import a Gmail thread to fill this automatically…"
          className="textarea"
        />
      </Field>

      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
          Documents
        </span>

        {/* One source area: drop files OR pull them from Gmail. */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          className={cn(
            'flex min-h-[110px] flex-col items-center justify-center gap-2.5 rounded-md border-[1.5px] border-dashed px-4 py-5 text-center transition-colors',
            dragging
              ? 'border-[var(--color-brand)] bg-[var(--color-brand-light)]'
              : 'border-[var(--color-border-input)] bg-[#F9FAFB]',
          )}
        >
          <UploadCloud className="size-5 text-[var(--color-text-placeholder)]" />
          <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">
            Drop ACORD, GL supplemental, or loss runs
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-secondary"
            >
              <UploadCloud className="size-4" /> Browse files
            </button>
            <span className="text-xs text-[var(--color-text-placeholder)]">or</span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="btn-secondary"
            >
              <Mail className="size-4" /> Add from Gmail
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-placeholder)]">
            PDF or XLSX — up to 12 files, 25 MB each
          </p>
          <input
            ref={inputRef}
            type="file"
            name="files"
            multiple
            accept=".pdf,.xlsx,.csv,.txt,.eml,application/pdf"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        {/* Selected Gmail threads ride along as a hidden field on submit. */}
        <input type="hidden" name="gmailThreads" value={gmailThreadsJson} />

        {docRows.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {docRows.map((r) => (
              <li
                key={r.key}
                className="flex items-center gap-2 rounded-md bg-[#F9FAFB] px-3 py-2 text-xs"
              >
                {r.origin === 'gmail' ? (
                  <Mail className="size-3.5 shrink-0 text-[var(--color-text-placeholder)]" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-[var(--color-text-placeholder)]" />
                )}
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
                  {r.name}
                  {r.note && (
                    <span className="ml-1.5 text-[var(--color-text-placeholder)]">— {r.note}</span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    r.origin === 'gmail'
                      ? 'bg-[var(--color-brand-light)] text-[var(--color-brand)]'
                      : 'bg-neutral-200/70 text-[var(--color-text-muted)]',
                  )}
                >
                  {r.origin === 'gmail' ? 'Gmail' : 'Upload'}
                </span>
                {r.size > 0 && (
                  <span className="tabular text-[var(--color-text-placeholder)]">
                    {fmtSize(r.size)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(r)}
                  className="rounded p-0.5 text-[var(--color-text-placeholder)] hover:bg-neutral-200 hover:text-[var(--color-text-secondary)]"
                  aria-label={`Remove ${r.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        {isDirty && (
          <button type="button" onClick={reset} className="btn-secondary">
            <RotateCcw className="size-4" /> Clear
          </button>
        )}
        <SubmitButton enabled={hasContent} />
      </div>

      <GmailPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={addGmailSource}
        addedThreadIds={gmailSources.map((s) => s.threadId)}
      />
    </form>
  )
}

function SubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending || !enabled} className="btn-primary">
      {pending && <Loader2 className="size-4 animate-spin" />}
      Run Submission
      {!pending && <span aria-hidden>→</span>}
    </button>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
      </span>
      {children}
    </label>
  )
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
