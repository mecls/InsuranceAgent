-- 0003 — human_actions
--
-- Records the human-in-the-loop decisions: approving the broker clarification
-- email, applying field overrides, and binding the quote. Single-tenant demo, so
-- there is no `user` column.

create table if not exists public.human_actions (
  id       uuid primary key default gen_random_uuid(),
  run_id   uuid not null references public.runs(id) on delete cascade,
  type     text not null check (type in ('approve_send','reject_send','bind','override_field')),
  payload  jsonb not null default '{}'::jsonb,
  ts       timestamptz not null default now()
);

create index if not exists human_actions_run_idx on public.human_actions (run_id, ts);
