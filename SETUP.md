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

Default: **OpenAI-compatible, DeepSeek via Ollama Cloud**.

```
LLM_PROVIDER=openai-compatible      # REQUIRED — without it run-tool routes to Anthropic
LLM_BASE_URL=https://ollama.com/v1
LLM_API_KEY=...
LLM_MODEL=deepseek-v4-pro:cloud     # must support tool calling
LLM_MAX_TOKENS=32000
```

- On this path the model has **no native PDF vision**, so the extraction agent
  flattens the ACORD/supplemental PDFs to text (`lib/services/doc-parser.ts:pdfToText`)
  before the LLM call. The loss-run `.xlsx` and cover letter are already text.
- Ollama Cloud sometimes rejects a forced `tool_choice`; `run-tool` automatically
  retries with `tool_choice: auto` + content-JSON parsing + a bounded repair loop.
- To use Claude instead, set `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`
  (`ANTHROPIC_MODEL`, `ANTHROPIC_EXTRACTION_MODEL`); PDFs are then attached natively.

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
