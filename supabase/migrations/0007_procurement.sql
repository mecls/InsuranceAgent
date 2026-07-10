-- 0007 — procurement transformation
--
-- Reshapes the mail sink and human-action log for the Orçamentos agent, and adds
-- a channel table for posting run progress back to Slack. Additive and safe to
-- re-run. The Case File (suppliers, quotes, comparison, award) lives in
-- runs.case_file jsonb, so no runs columns change here.

-- 1. Widen the human-action types to the procurement action set.
alter table public.human_actions drop constraint if exists human_actions_type_check;
alter table public.human_actions
  add constraint human_actions_type_check
  check (type in (
    'send_rfq', 'chase', 'proceed', 'adjudicate',
    'reject_quote', 'skip_supplier', 'override_field',
    -- legacy values kept so old rows remain valid
    'approve_send', 'reject_send', 'bind'
  ));

-- 2. broker_outbox → email_messages (two-way mail log for the case).
alter table if exists public.broker_outbox rename to email_messages;
alter table public.email_messages
  add column if not exists direction text not null default 'outbound'
    check (direction in ('outbound', 'inbound')),
  add column if not exists supplier_id text,
  add column if not exists thread_id text;

-- 3. run_channels — where to post progress back (Slack channel + thread).
create table if not exists public.run_channels (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs(id) on delete cascade,
  kind       text not null default 'slack',
  channel    text not null,
  thread_ts  text,
  created_at timestamptz not null default now()
);

create index if not exists run_channels_run_idx on public.run_channels (run_id);
