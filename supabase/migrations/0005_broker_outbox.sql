-- 0005 — broker_outbox (the gated email sink)
--
-- "Sending" the broker clarification email writes here — a captured demo outbox,
-- never a real broker mailbox. A human approves the send before EmailSender
-- inserts a row (Inngest waitForEvent gate).

create table if not exists public.broker_outbox (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.runs(id) on delete cascade,
  to_address text not null,
  subject    text not null,
  body       text not null,
  sent_at    timestamptz not null default now()
);

create index if not exists broker_outbox_run_idx on public.broker_outbox (run_id, sent_at);
