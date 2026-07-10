# Setup — Miraside Orçamentos (vendor quoting agent)

A customer asks your business for a price (WhatsApp / email / a form). The agent
**clarifies the missing details with the customer and chases**, **prices from your
editable catálogo**, **drafts the orçamento**, and — with the **Automate** switch —
either **auto-sends** it or lands it as a **draft you review and send**. The whole
workflow is visible on a live node graph.

## 1. Install

```
npm install
cp .env.example .env.local   # then fill in the values
```

## 2. Supabase

1. Create a Supabase project; put the URL + service-role key in `.env.local`.
2. Apply the migrations in order (SQL editor or `supabase db push`):
   ```
   0001_runs.sql  0002_events.sql  0003_human_actions.sql  0004_storage.sql
   0005_broker_outbox.sql  0006_gmail_credentials.sql
   0007_procurement.sql   # human_actions types + email_messages + run_channels
   0008_quoting.sql       # catalog_items (seeded) + app_settings — REQUIRED
   ```
   **0007 and 0008 are load-bearing.** 0007 widens the `human_actions` type check
   (the review gate records the approval) and provides `email_messages` (the case
   mail log) + `run_channels` (Slack). 0008 creates the **catálogo de preços**
   (seeded with 2025-2026 PT market averages) and `app_settings` (the Automate
   switch). Pricing FAILS without the catálogo.

## 3. LLM

Default: **OpenAI-compatible, DeepSeek via Ollama Cloud** (unchanged).
```
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://ollama.com/v1
LLM_API_KEY=...
LLM_MODEL=deepseek-v4-pro:cloud     # must support tool calling
LLM_MAX_TOKENS=32000
```
The model parses the request, drafts the clarifying questions, SELECTS catálogo
items + quantities, and writes the quote text. All money — line totals, per-rate
IVA, grand total — is computed deterministically in `lib/procurement/pricing.ts`.

## 4. Customer channels (optional — real comms)

> **Configuring WhatsApp + Slack from scratch?** See the step-by-step guide in
> [`WHATSAPP_SLACK_SETUP.md`](./WHATSAPP_SLACK_SETUP.md) (Meta webhook, Slack app
> manifest, env vars, local tunnel, tests, troubleshooting).

The agent replies to the customer on the channel they used.
- **Email:** `RESEND_API_KEY`, `RFQ_FROM_EMAIL`, `INBOUND_EMAIL_DOMAIN`. Point a mail
  relay's inbound webhook at `POST /api/email/inbound`. A plus-addressed reply
  (`orcamentos+<runId>.cliente@domain`) resolves the await-customer gate; a plain
  email opens a new draft.
- **WhatsApp (Meta Cloud API):** `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`,
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Webhook URL `/api/whatsapp/inbound`
  (GET verify + POST messages, X-Hub-Signature-256). Inbound from a known phone
  resolves the gate; a new phone opens a draft.
- **Slack (internal):** `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`. `/orcamento`
  → `POST /api/slack/commands`; interactivity → `/api/slack/interactivity`;
  events → `/api/slack/events`. `/orcamento fachada` launches a demo and posts the
  quote + an Approve button back to the thread.

## 5. Run it

```
npm run dev
npx inngest-cli@latest dev        # durable functions at /api/inngest
```
Open http://localhost:3000 → `/dashboard`.

## 6. What to film (the whole workflow)

1. Toggle **Modo Automatizar** off, then click a demo (e.g. **Pintura de fachada —
   cliente por WhatsApp**).
2. Watch the graph: **Receber pedido → Esclarecer** (a question is drafted) →
   **Aguardar cliente** (the customer's answer arrives, with a chase in between) →
   **Calcular preços** (line items priced from the catálogo, with IVA) →
   **Redigir orçamento** → **Rever & aprovar** (park) → **Enviar ao cliente**.
3. On the run, flip to the **Orçamento** tab: the line-items table, per-rate IVA and
   total, the message to the customer, and the clarification trail. Click **Aprovar
   e enviar** → the orçamento is sent → download the PDF → **Repetir** (replay).
4. Turn **Modo Automatizar** ON and run again: it clarifies → prices → drafts →
   **sends automatically**, no stop.
5. Edit a rate in **Catálogo de preços** and re-run to see the total change.
6. Inbound: POST to `/api/whatsapp/inbound` (or email) → the parsed request appears
   in **Caixa de entrada** → **Iniciar** (or auto-starts when Automate is on).
`npx tsc --noEmit`; `npm run lint`; `npm run build`.
