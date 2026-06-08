# Setup

Single-tenant demo — no auth, no OAuth, no PII. You need a Supabase project, an
Anthropic API key, and the Inngest dev server. A Tavily key is optional (web
research degrades gracefully without it).

## 1. Install

```
npm install
cp .env.example .env.local   # then fill in the values
```

## 2. Supabase

1. Create a Supabase project. Put the project URL + service-role key in `.env.local`
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; the `NEXT_PUBLIC_*` mirrors are
   optional for now).
2. Apply the migrations in order (SQL editor or `supabase db push`):
   ```
   supabase/migrations/0001_runs.sql
   supabase/migrations/0002_events.sql
   supabase/migrations/0003_human_actions.sql
   supabase/migrations/0004_storage.sql        # creates the `submissions` bucket
   supabase/migrations/0005_broker_outbox.sql
   ```
   These create `runs`, `events`, `human_actions`, `broker_outbox`, and the
   `submissions` storage bucket.

## 3. LLM

- Set `ANTHROPIC_API_KEY`. Defaults: `ANTHROPIC_MODEL=claude-sonnet-4-6` for the
  reasoning sections, `ANTHROPIC_EXTRACTION_MODEL=claude-haiku-4-5` for high-volume
  extraction. PDFs are attached natively to Claude (no OCR engine needed).
- Optional OpenAI-compatible fallback exists but does **not** support PDFs.

## 4. Web research (optional)

- Set `TAVILY_API_KEY` for live web research in the Research phase. Without it,
  the agent runs and says plainly that no web provider is configured, leaning on
  the (simulated) data feeds + the submission.

## 5. Run it

In two terminals:

```
npm run dev
npx inngest-cli@latest dev        # serves the durable functions at /api/inngest
```

Open http://localhost:3000 → redirects to `/dashboard`. Pick a scenario
(**Clean**, **Referral**, or **Missing fields**) to start a run, then watch the
node graph stream live.

## 6. What to look for (filmable beats)

- **Hero**: a messy broker packet becomes a structured Case File — extraction
  fields light up with confidence + source (click the Extraction node).
- **Gappy scenario** → the Gap node parks in *Needs review*; an amber banner shows
  the drafted broker email. Approve send → a row lands in `broker_outbox` (never a
  real send). Skip → the run continues without sending.
- **Referral scenario** → Appetite emits a knockout (prohibited class / heavy
  losses) and the decision is `REFER` / `OUT`.
- **Clean scenario** → full run to an indicative quote (labelled *simulated
  rating*) + audit trail. Click **Review & bind**, optionally override the premium,
  and bind → a demo policy number is written.
- **Replay** (on a finished run) → re-stream the event log at 1× / 2× / 4× for
  clean takes.

## Notes / upgrade paths

- The GuidelineStore (`lib/services/guideline-store.ts`) uses an in-repo GL manual
  with keyword retrieval. It can be upgraded to vector RAG (e.g. the Supabase
  gte-small Edge Function used by the sibling EmailAgent) behind the same interface.
- `RESEND_API_KEY` + `OPS_ALERT_EMAIL` are optional (reserved for failure alerts).
