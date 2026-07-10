'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Play, Plus, X } from 'lucide-react'
import { startCaseRun, startDemoRun } from '@/app/actions/runs'
import { SCENARIOS } from '@/lib/demo/scenarios'
import { cn } from '@/lib/utils'

/**
 * Novo pedido — open a quoting case from a customer request. Real intake happens
 * on the channels (WhatsApp/email auto-open cases into the Caixa de entrada; Slack
 * via /orcamento), so this is a secondary surface: a quick-launch row that plays a
 * scripted demo, plus a collapsed manual form for phone/walk-in requests.
 */
export function NewCase() {
  const [manualOpen, setManualOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="text-xs font-medium text-[var(--color-text-secondary)]">
          Ver demonstração — o fluxo completo, sem configurar nada
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.values(SCENARIOS).map((s) => (
            <form key={s.id} action={startDemoRun}>
              <input type="hidden" name="scenario" value={s.id} />
              <DemoButton label={s.label} />
            </form>
          ))}
        </div>
      </div>

      {!manualOpen ? (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="btn-secondary"
        >
          <Plus className="size-3.5" />
          Abrir caso manualmente
          <span className="text-[var(--color-text-muted)]">— pedido por telefone ou presencial</span>
        </button>
      ) : (
        <form action={startCaseRun} className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Abrir caso manualmente
            </div>
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              className="btn-ghost"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </button>
          </div>
          <Field label="Pedido do cliente">
            <textarea
              name="summary"
              rows={2}
              placeholder="Ex.: Pintar a fachada do prédio, cerca de 200 m2, com impermeabilização."
              className="textarea"
              required
            />
          </Field>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Cliente">
              <input name="customerName" placeholder="Nome do cliente" className="input" />
            </Field>
            <Field label="Contacto (email ou telemóvel)">
              <input name="contact" placeholder="cliente@email.pt ou +351…" className="input" />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Canal">
              <select name="channel" className="input" defaultValue="form">
                <option value="form">Formulário</option>
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </Field>
            <Field label="Setor">
              <select name="vertical" className="input" defaultValue="obra">
                <option value="obra">Obra / pintura</option>
                <option value="remodelacao">Remodelação</option>
                <option value="canalizacao">Canalização</option>
                <option value="limpeza">Limpeza / manutenção</option>
                <option value="generico">Outro</option>
              </select>
            </Field>
            <Field label="Categoria">
              <input name="category" placeholder="Pintura de fachada" className="input" />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-end">
            <SubmitButton />
          </div>
        </form>
      )}
    </div>
  )
}

function DemoButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="btn-secondary text-left">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-3.5" />}
      {label}
    </button>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending && <Loader2 className="size-4 animate-spin" />}
      Abrir caso e orçamentar
      {!pending && <span aria-hidden>→</span>}
    </button>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
      {children}
    </label>
  )
}
