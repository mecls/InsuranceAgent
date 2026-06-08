import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/**
 * Service-role Supabase client (server only).
 *
 * This is a single-tenant demo, so there is no RLS to bypass — but the key is
 * still privileged: never import this into client components or expose it. Used
 * by Server Actions, the Inngest worker, and the SSE stream route.
 */
let cached: SupabaseClient | null = null

export function supabaseService(): SupabaseClient {
  if (cached) return cached
  cached = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  })
  return cached
}
