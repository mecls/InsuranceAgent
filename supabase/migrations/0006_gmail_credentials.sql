-- 0006 — Gmail (read-only) on the shared google_credentials table
--
-- This app reuses the existing public.google_credentials table (keyed by
-- account_id → accounts) rather than its own table. Two additions:
--
--   1. an `agent` label so we can see which product a connection belongs to
--      (this app writes/reads rows tagged agent = 'insurance_agent');
--   2. thin SECURITY DEFINER wrappers over Supabase Vault, so the service-role
--      client can store/read the OAuth refresh token by id — the token lives in
--      Vault and google_credentials.refresh_secret_id references it.
--
-- google_credentials + accounts already exist (created elsewhere); this only
-- adds the column + the wrappers.

alter table public.google_credentials
  add column if not exists agent text;

-- ── Vault wrappers (callable via PostgREST rpc as the service role) ──────────

create or replace function public.vault_create_secret(secret text, secret_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare sid uuid;
begin
  select vault.create_secret(secret, secret_name) into sid;
  return sid;
end;
$$;

create or replace function public.vault_read_secret(secret_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare val text;
begin
  select decrypted_secret into val from vault.decrypted_secrets where id = secret_id;
  return val;
end;
$$;

create or replace function public.vault_delete_secret(secret_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = secret_id;
end;
$$;

grant execute on function public.vault_create_secret(text, text) to service_role;
grant execute on function public.vault_read_secret(uuid) to service_role;
grant execute on function public.vault_delete_secret(uuid) to service_role;
