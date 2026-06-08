-- 0002 — events (the backbone)
--
-- Append-only event log. `seq` is a global identity column, so ordering within a
-- run is a monotonic subsequence with no per-run counter to race on (parallel
-- section calls can emit concurrently and still order correctly). This one table
-- drives the live dashboard, powers Replay, and is read by the Compliance & Audit
-- agent to assemble the audit trail.

create table if not exists public.events (
  seq      bigint generated always as identity primary key,
  run_id   uuid not null references public.runs(id) on delete cascade,
  node_id  text not null,
  type     text not null,
  ts       timestamptz not null default now(),
  payload  jsonb not null default '{}'::jsonb
);

-- The SSE stream tails by (run_id, seq); the audit agent reads a full run.
create index if not exists events_run_seq_idx on public.events (run_id, seq);
