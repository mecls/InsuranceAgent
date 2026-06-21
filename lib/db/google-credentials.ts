import { supabaseService } from '@/lib/supabase/service'

/**
 * Read-only Gmail credentials on the shared `google_credentials` table.
 *
 * - Tagged `agent = 'insurance_agent'` so we can see which product owns it.
 * - `account_id` resolves to an `accounts` row, found-or-created from the
 *   connected Google profile email (this app has no auth of its own).
 * - The OAuth refresh token is NOT stored here — it lives in Supabase Vault and
 *   `refresh_secret_id` references it (read/written via the public.vault_*
 *   wrappers from migration 0006).
 *
 * Note: the table's primary key is `account_id` alone, so an account holds one
 * google connection total; this app replaces it under its own agent tag.
 */

const AGENT = 'insurance_agent'

export interface GoogleCredentials {
  account_id: string
  google_sub: string | null
  email: string | null
  refresh_secret_id: string
  scope: string | null
  agent: string | null
  updated_at: string
}

async function findOrCreateAccount(ownerEmail: string): Promise<string> {
  const svc = supabaseService()
  const { data: existing, error: selErr } = await svc
    .from('accounts')
    .select('id')
    .eq('owner_email', ownerEmail)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (selErr) throw new Error(`accounts lookup failed: ${selErr.message}`)
  if (existing) return existing.id as string

  const { data: created, error: insErr } = await svc
    .from('accounts')
    .insert({ owner_email: ownerEmail })
    .select('id')
    .single()
  if (insErr || !created) {
    throw new Error(`account create failed: ${insErr?.message ?? 'no data'}`)
  }
  return created.id as string
}

/** The connected Gmail credential row for this app (agent tag), or null. */
export async function getConnectedAccount(): Promise<GoogleCredentials | null> {
  const { data, error } = await supabaseService()
    .from('google_credentials')
    .select('*')
    .eq('agent', AGENT)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getConnectedAccount failed: ${error.message}`)
  return (data as GoogleCredentials | null) ?? null
}

/** Decrypt the stored refresh token from Vault. Throws if not connected. */
export async function getRefreshToken(): Promise<string> {
  const row = await getConnectedAccount()
  if (!row) throw new Error('Gmail not connected')
  const { data, error } = await supabaseService().rpc('vault_read_secret', {
    secret_id: row.refresh_secret_id,
  })
  if (error) throw new Error(`vault read failed: ${error.message}`)
  if (!data) throw new Error('refresh token secret missing')
  return data as string
}

/** Store (or replace) the connection: refresh token → Vault, metadata → table. */
export async function saveGoogleCredentials(args: {
  email: string
  googleSub: string | null
  refreshToken: string
  scope: string | null
}): Promise<void> {
  const svc = supabaseService()
  const accountId = await findOrCreateAccount(args.email)

  // Drop any prior secret on this account (PK is account_id) before writing fresh.
  const { data: prev } = await svc
    .from('google_credentials')
    .select('refresh_secret_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (prev?.refresh_secret_id) {
    await svc.rpc('vault_delete_secret', { secret_id: prev.refresh_secret_id })
  }

  const { data: secretId, error: secErr } = await svc.rpc('vault_create_secret', {
    secret: args.refreshToken,
    secret_name: `gmail_refresh_${AGENT}_${crypto.randomUUID().slice(0, 8)}`,
  })
  if (secErr || !secretId) {
    throw new Error(`vault create failed: ${secErr?.message ?? 'no id'}`)
  }

  const { error } = await svc.from('google_credentials').upsert(
    {
      account_id: accountId,
      agent: AGENT,
      google_sub: args.googleSub,
      email: args.email,
      refresh_secret_id: secretId as string,
      scope: args.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )
  if (error) throw new Error(`saveGoogleCredentials failed: ${error.message}`)
}

/** Forget the connection (deletes the Vault secret + the credential row). */
export async function deleteGoogleCredentials(): Promise<void> {
  const svc = supabaseService()
  const row = await getConnectedAccount()
  if (!row) return
  if (row.refresh_secret_id) {
    await svc.rpc('vault_delete_secret', { secret_id: row.refresh_secret_id })
  }
  const { error } = await svc
    .from('google_credentials')
    .delete()
    .eq('account_id', row.account_id)
    .eq('agent', AGENT)
  if (error) throw new Error(`deleteGoogleCredentials failed: ${error.message}`)
}
