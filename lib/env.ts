/**
 * Typed environment access.
 *
 * Server-only secrets are read lazily through getters that throw a clear error
 * when missing — so a missing key surfaces at the call site, not as a cryptic
 * `undefined` deep inside an SDK. Public (browser-exposed) values are referenced
 * via their literal `process.env.NEXT_PUBLIC_*` names so Next can inline them at
 * build time.
 *
 * Single-tenant demo: no auth, no OAuth, no per-user secrets.
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return v
}

/** Public Supabase config — safe to ship to the browser. */
export const PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
export const PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const env = {
  // Supabase (service-role — server only, never expose).
  supabaseUrl: () => required('SUPABASE_URL'),
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),

  // Google OAuth (read-only Gmail ingestion). Client id/secret are required for
  // the Connect Gmail flow; the refresh token is minted by consent and stored in
  // Supabase (not env). See lib/services/gmail.ts.
  googleOAuthClientId: () => required('GOOGLE_OAUTH_CLIENT_ID'),
  googleOAuthClientSecret: () => required('GOOGLE_OAUTH_CLIENT_SECRET'),

  // Web research provider (Tavily). Optional — Research agent degrades to a
  // documented "no web access configured" note if absent.
  tavilyApiKey: () => process.env.TAVILY_API_KEY ?? '',

  // Resend (onFailure ops alerts). Optional.
  resendApiKey: () => process.env.RESEND_API_KEY ?? '',
  opsAlertEmail: () => process.env.OPS_ALERT_EMAIL ?? '',

  // App base URL. Precedence: explicit APP_BASE_URL → Vercel prod domain →
  // localhost.
  appBaseUrl: () => {
    const explicit = process.env.APP_BASE_URL
    if (explicit) return explicit.replace(/\/$/, '')
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    if (vercel) return `https://${vercel}`
    return 'http://localhost:3000'
  },
} as const
