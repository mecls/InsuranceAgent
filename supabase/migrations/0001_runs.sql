-- 0001 — runs
--
-- One row per underwriting run. `case_file` accumulates the typed Case File as
-- each agent writes its slice. Single-tenant demo: access is via the
-- service-role key only, so RLS is left off (there is no per-user data to scope).

create extension if not exists pgcrypto;

create table if not exists public.runs (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  status           text not null default 'pending'
                     check (status in ('pending','running','awaiting_human','ready','failed')),
  submission_label text not null,
  scenario         text not null default 'upload',
  case_file        jsonb,
  bound_policy     jsonb,
  error_message    text,
  created_at       timestamptz not null default now(),
  ready_at         timestamptz
);

create index if not exists runs_created_at_idx on public.runs (created_at desc);
