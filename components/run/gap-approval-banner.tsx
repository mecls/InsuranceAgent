'use client'

import { useState } from 'react'
import { Mail, Loader2 } from 'lucide-react'
import type { NodeState } from '@/lib/run-state'
import { respondBrokerEmail } from '@/app/actions/runs'

interface Draft {
  subject?: string
  body?: string
}

/**
 * Approval bar for the gated broker clarification email. Shown while the Gap node
 * is awaiting_human. Reads the staged draft from the node's output event and
 * lets the underwriter send (to the demo outbox) or skip — resuming the parked
 * orchestrator step.
 */
export function GapApprovalBanner({
  runId,
  gap,
}: {
  runId: string
  gap: NodeState
}) {
  const [pending, setPending] = useState<null | 'send' | 'skip'>(null)
  const [open, setOpen] = useState(false)

  // The gap agent emits node.output with detail { gaps, draft }.
  const out = gap.outputs.find(
    (o): o is { draft?: Draft } =>
      !!o && typeof o === 'object' && 'draft' in (o as object),
  )
  const draft = out?.draft

  const respond = async (approved: boolean) => {
    setPending(approved ? 'send' : 'skip')
    try {
      await respondBrokerEmail(runId, approved)
    } catch {
      setPending(null)
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-900">
            Broker clarification email drafted — approve send?
          </div>
          {draft?.subject && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-0.5 text-xs text-amber-700 underline-offset-2 hover:underline"
            >
              {open ? 'Hide draft' : `Preview: “${draft.subject}”`}
            </button>
          )}
          {open && draft?.body && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-3 text-xs text-neutral-700">
              {draft.body}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => respond(false)}
            disabled={pending !== null}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {pending === 'skip' ? 'Skipping…' : 'Skip'}
          </button>
          <button
            onClick={() => respond(true)}
            disabled={pending !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending === 'send' && <Loader2 className="size-3.5 animate-spin" />}
            Approve &amp; send
          </button>
        </div>
      </div>
    </div>
  )
}
