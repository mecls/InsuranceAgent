'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { inngest } from '@/lib/inngest/client'
import { createRun, saveCaseFile } from '@/lib/db/runs'
import { emptyCaseFile, type CustomerChannel, type Vertical } from '@/lib/procurement/case-file'
import { getAutomate, setAutomate } from '@/lib/db/settings'
import { getScenario } from '@/lib/demo/scenarios'

/**
 * Start a scripted demo run for one of the built-in scenarios. Seeds the customer
 * + request and enqueues the orchestrator, which self-drives the customer's
 * clarifying reply so the whole flow plays on camera.
 */
export async function startDemoRun(formData: FormData): Promise<void> {
  const scenarioId = String(formData.get('scenario') ?? 'fachada')
  const scenario = getScenario(scenarioId)
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`)

  const { id, slug } = await createRun({ submissionLabel: scenario.request.summary, scenario: scenario.id })

  const caseFile = emptyCaseFile(slug)
  caseFile.demo = true
  caseFile.automate = false
  caseFile.vertical = scenario.vertical
  caseFile.customer = { ...scenario.customer }
  caseFile.request = { ...scenario.request }
  caseFile.status = 'recebido'
  caseFile.source = { type: 'web' }
  await saveCaseFile(id, caseFile)

  await inngest.send({ name: 'quote/run-requested', data: { runId: id } })

  revalidatePath('/dashboard')
  redirect(`/dashboard/runs/${slug}`)
}

const VERTICALS: Vertical[] = ['obra', 'remodelacao', 'canalizacao', 'limpeza', 'generico']
const CHANNELS: CustomerChannel[] = ['whatsapp', 'email', 'form']

/**
 * Start a real case from the web form. The Automate switch controls the review
 * gate (auto-approve + send vs park for the user). This is the "fill a form"
 * intake channel; WhatsApp and email seed the same Case File.
 */
export async function startCaseRun(formData: FormData): Promise<void> {
  const summary = String(formData.get('summary') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim()
  const customerName = String(formData.get('customerName') ?? '').trim()
  const contact = String(formData.get('contact') ?? '').trim()
  const channelRaw = String(formData.get('channel') ?? 'form')
  const channel: CustomerChannel = CHANNELS.includes(channelRaw as CustomerChannel) ? (channelRaw as CustomerChannel) : 'form'
  const verticalRaw = String(formData.get('vertical') ?? 'generico')
  const vertical: Vertical = VERTICALS.includes(verticalRaw as Vertical) ? (verticalRaw as Vertical) : 'generico'

  if (!summary) throw new Error('Indique o pedido do cliente.')

  const { id, slug } = await createRun({ submissionLabel: summary, scenario: 'web' })

  const caseFile = emptyCaseFile(slug)
  caseFile.demo = false
  caseFile.automate = await getAutomate()
  caseFile.vertical = vertical
  caseFile.customer = { name: customerName || undefined, channel, contact: contact || undefined }
  caseFile.request = { summary, rawText: summary, category: category || null }
  caseFile.status = 'recebido'
  caseFile.source = { type: 'web' }
  await saveCaseFile(id, caseFile)

  await inngest.send({ name: 'quote/run-requested', data: { runId: id } })

  revalidatePath('/dashboard')
  redirect(`/dashboard/runs/${slug}`)
}

/** Start a draft case that was held for review (Automate OFF). */
export async function startRun(runId: string): Promise<void> {
  await inngest.send({ name: 'quote/run-requested', data: { runId } })
  revalidatePath('/dashboard')
}

/** Resolve the review gate: approve + send the quote. */
export async function approveQuote(runId: string): Promise<void> {
  await inngest.send({ name: 'quote/human-approval', data: { runId, approved: true } })
}

/** Resolve the review gate with no send. */
export async function rejectQuote(runId: string): Promise<void> {
  await inngest.send({ name: 'quote/human-approval', data: { runId, approved: false } })
}

/** Toggle the global Automate switch. */
export async function toggleAutomate(value: boolean): Promise<void> {
  await setAutomate(value)
  revalidatePath('/dashboard')
}
