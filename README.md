# InsuranceAgent

An agentic underwriting assistant for commercial **General Liability**: a broker
submission becomes a quote-ready file, run by a crew of specialist agents with a
human underwriter in the loop — fronted by a **real-time node-graph dashboard**
that shows every phase as it streams.

> Sibling product to `EmailAgent` / `miraside`. Same stack: **Next.js 16 + TypeScript
> + Supabase + Inngest + Anthropic + SSE**, deployable on Vercel. Single-tenant
> demo, no auth, zero real PII.

## The pipeline

```
intake → extraction → gap → research → appetite → pricing → compliance → review/bind
```

Each phase is an Inngest durable step that emits structured events into an
append-only `events` table. That one table is the backbone: it drives the live
dashboard over SSE, powers the **Replay** scrubber, and is read by the Compliance
agent to assemble the audit trail.

| Phase | What it does | Real / Sim |
|---|---|---|
| **Intake** | Materializes the broker packet into real files, classifies attachments | real |
| **Extraction** | ACORD/supplemental PDFs → Claude (native vision); loss-run `.xlsx` → SheetJS → text. Emits fields with confidence + source | real |
| **Gap & Broker-Comms** | Validates vs. the GL required-fields checklist; drafts a clarification email. **Send is gated** (human approves) | real draft / gated send |
| **Research & Enrichment** | Live web search (Tavily) + mock data feeds → sourced dossier + risk signals | web real / feeds sim |
| **Appetite & Risk** | Deterministic GL appetite ruleset + guideline retrieval → decision/score/knockouts with cited rationale | real |
| **Pricing & Quote** | Deterministic **simulated** rating engine → premium + breakdown; LLM assembles quote + pre-bind checklist | rating sim |
| **Compliance & Audit** | Reads the event log → audit trail + compliance verdict | real |
| **Underwriter review** | Quote + dossier + appetite + audit; field override; **bind is gated** → demo policy record | gated |

## Guiding principles

- **The LLM never does math.** Gap detection, appetite rules + score, and premium
  rating are deterministic (`lib/underwriting/gl-rules.ts`, `lib/services/rating-engine.ts`).
  The model writes rationale and prose only.
- **Everything is sourced.** Extracted fields carry confidence + a file/page/cell
  pointer; appetite reasons cite a rule id + guideline section; research claims carry citations.
- **Human-in-the-loop on side effects.** Sending the broker email and binding the
  quote require explicit approval (Inngest `waitForEvent` gate / gated server action).
- **One render path for live + replay.** The client folds the same event stream
  through `lib/run-state.ts` whether live (SSE) or replaying.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind v4
- Supabase (Postgres + Storage) via the service-role client
- Inngest v3 durable step functions
- `@anthropic-ai/sdk` through `lib/llm/run-tool.ts` (forced-tool structured output,
  native PDF attachment, ephemeral caching, OpenAI-compatible fallback)
- `@xyflow/react` (React Flow) for the node graph
- `postal-mime` (.eml) + `xlsx` / SheetJS (loss runs)

## Commands

```
npm run dev        # next dev
npm run build      # next build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

See **SETUP.md** to provision Supabase + Inngest and run a demo end to end.

## Production vs. demo boundary

The agents are real. The explicit integration points — labelled on screen — are
the **rating engine** (`lib/services/rating-engine.ts`), the **paid data feeds**
(`lib/services/data-feeds.ts`), and the **policy-system write** (bind → demo record).
Each sits behind a clean interface so it swaps for a carrier integration without
touching agent logic.
