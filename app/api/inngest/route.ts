import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { functions } from '@/lib/inngest/functions'

// Inngest steps run inside this Vercel function. Node runtime: the worker uses
// the Supabase service-role SDK and the Anthropic SDK. Generous duration so a
// step (extraction, research) never gets cut off mid-flight.
export const runtime = 'nodejs'
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
