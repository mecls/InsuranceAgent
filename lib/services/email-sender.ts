import { supabaseService } from '@/lib/supabase/service'

/**
 * EmailSender — GATED. In the demo, "sending" the broker clarification email
 * writes to a captured outbox table; it never reaches a real broker. A human
 * must approve the send (Inngest waitForEvent gate) before this is called.
 * Production swaps in the carrier mail relay behind the same interface.
 */
export async function sendToOutbox(args: {
  runId: string
  to: string
  subject: string
  body: string
}): Promise<void> {
  const { error } = await supabaseService()
    .from('broker_outbox')
    .insert({
      run_id: args.runId,
      to_address: args.to,
      subject: args.subject,
      body: args.body,
    })
  if (error) throw new Error(`sendToOutbox failed: ${error.message}`)
}
