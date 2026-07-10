# Configuring WhatsApp & Slack — Miraside Orçamentos

Step-by-step guide to wire the two live channels so requests flow in and quotes
flow out without touching the manual form.

- **WhatsApp = customer intake.** A customer message auto-opens a Case File and
  starts the quoting workflow; the agent replies to the customer on WhatsApp.
- **Slack = internal ops.** Your team opens cases with `/orcamento`, watches
  progress in-thread, and approves/rejects the drafted quote with a button.

Everything below maps to real routes in this repo — no extra code needed:

| Channel | Purpose | Endpoint (in code) |
|---|---|---|
| WhatsApp | Verify + receive messages | `GET`/`POST` `/api/whatsapp/inbound` |
| Slack | Slash command `/orcamento` | `POST` `/api/slack/commands` |
| Slack | @mention / message events | `POST` `/api/slack/events` |
| Slack | Approve/Reject buttons | `POST` `/api/slack/interactivity` |

---

## 0. Prerequisite — a public HTTPS URL

Meta and Slack only call **public HTTPS** URLs, so `localhost` won't work directly.

- **Deployed (recommended):** deploy to Vercel; your base URL is
  `https://<your-app>.vercel.app` (or your custom domain).
- **Local development:** run a tunnel to port 3000 and use the tunnel URL as your
  base URL wherever this guide says `https://YOUR_DOMAIN`:
  ```bash
  # pick one
  ngrok http 3000
  cloudflared tunnel --url http://localhost:3000
  ```
  Keep the tunnel running; its URL changes each restart (unless you use a reserved
  domain), and you must update the URL in the Meta/Slack dashboards when it does.

Set your base URL in `.env.local` (used for building reply-to addresses and links):
```bash
APP_BASE_URL=https://YOUR_DOMAIN
```

Restart `npm run dev` after any `.env.local` change — env is read at boot.

---

## Part A — WhatsApp (Meta Cloud API)

### A1. Create the Meta app
1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. Choose use case **Other** → app type **Business**.
3. On the app dashboard, find **WhatsApp** → **Set up**. This adds a free test
   phone number and a sandbox.

### A2. Collect the sending credentials
On **WhatsApp → API Setup** you'll see:
- **Phone number ID** → this is `WHATSAPP_PHONE_NUMBER_ID`.
- **Temporary access token** (valid 24h) → this is `WHATSAPP_TOKEN` for quick tests.
  For anything lasting, create a permanent token in **A6**.

On **App Settings → Basic**:
- **App Secret** → this is `WHATSAPP_APP_SECRET` (used to verify the
  `X-Hub-Signature-256` on every inbound POST).

### A3. Invent a verify token
Pick any random string — it's a shared secret used only for the webhook handshake:
```bash
WHATSAPP_VERIFY_TOKEN=some-long-random-string-you-choose
```

### A4. Put the four values in `.env.local`
```bash
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_TOKEN=EAAG...            # temp (24h) or permanent (see A6)
WHATSAPP_APP_SECRET=abc123...     # App Settings → Basic → App Secret
WHATSAPP_VERIFY_TOKEN=some-long-random-string-you-choose
```
Restart the dev server (or redeploy) so they're loaded.

> How they're used (see `app/api/whatsapp/inbound/route.ts` and
> `lib/services/customer-comms.ts`): `VERIFY_TOKEN` gates the GET handshake,
> `APP_SECRET` verifies the POST signature, and `TOKEN` + `PHONE_NUMBER_ID` send
> the reply via `graph.facebook.com/v21.0/<id>/messages`.

### A5. Configure the webhook
1. In the app dashboard: **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL:** `https://YOUR_DOMAIN/api/whatsapp/inbound`
3. **Verify token:** the exact value of `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta sends a `GET` with `hub.challenge`; the route
   echoes it back when the token matches. A green check = verified.
5. Under **Webhook fields**, click **Manage** and **Subscribe** to **`messages`**.
   (This is the only field required.)

### A6. (Production) A permanent access token
The temporary token dies in 24h. For a lasting integration:
1. **business.facebook.com → Business Settings → Users → System users** → add a
   system user (role: Admin).
2. **Add assets** → assign your app + the WhatsApp account with full control.
3. **Generate new token** → select the app → scopes **`whatsapp_business_messaging`**
   and **`whatsapp_business_management`** → copy it into `WHATSAPP_TOKEN`.

### A7. Test it
**Inbound (open a case):** from a phone allowed in the sandbox (WhatsApp → API
Setup → "To" list), send a message to the test number. Within seconds a case
appears in the dashboard **Caixa de entrada**.

**Inbound without Meta (pure local test):** if `WHATSAPP_APP_SECRET` is *unset*,
the signature check is skipped, so you can simulate a message with `curl`:
```bash
curl -X POST "https://YOUR_DOMAIN/api/whatsapp/inbound" \
  -H 'Content-Type: application/json' \
  -d '{"entry":[{"changes":[{"value":{"messages":[
        {"from":"351912345678","type":"text",
         "text":{"body":"Pintar a fachada do prédio, ~200m2, com impermeabilização"}}
      ]}}]}]}'
```
A new draft case should show up in **Caixa de entrada**.

**Outbound (reply to customer):** only real (non-demo) runs send. The agent
replies on WhatsApp when `caseFile.customer.channel === 'whatsapp'`.

> ⚠️ **24-hour window.** The Cloud API only lets you send *free-form* text within
> 24h of the customer's last message. Since here the customer always messages
> first (that's what opens the case) and the quote goes back quickly, this is fine.
> If you ever need to message a customer *cold* or after 24h, Meta requires a
> pre-approved **message template** — not implemented in `sendWhatsApp()` today.

---

## Part B — Slack

You can configure the Slack app in one shot with a manifest (fast), or click
through the UI. Use **B1**.

### B1. Create the app from a manifest (recommended)
1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your workspace, paste the YAML below (replace **both** `YOUR_DOMAIN`s):

```yaml
display_information:
  name: Orçamentos
features:
  bot_user:
    display_name: Orçamentos
    always_online: true
  slash_commands:
    - command: /orcamento
      url: https://YOUR_DOMAIN/api/slack/commands
      description: Abrir um caso e orçamentar
      usage_hint: "[descrição | cenário | emails]"
      should_escape: false
oauth_config:
  scopes:
    bot:
      - chat:write        # post the anchor message + progress + quote blocks
      - commands          # the /orcamento slash command
      - app_mentions:read # open a case from an @mention
settings:
  event_subscriptions:
    request_url: https://YOUR_DOMAIN/api/slack/events
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://YOUR_DOMAIN/api/slack/interactivity
  org_deploy_enabled: false
  socket_mode_enabled: false
```

> Slack validates the `request_url`s immediately by POSTing a `url_verification`
> challenge, so **your app must be deployed / tunnel running before you paste**.
> The `/api/slack/events` route answers that challenge automatically.

3. Review → **Create**.

### B2. Install to the workspace & get the tokens
1. **OAuth & Permissions → Install to Workspace** → Allow.
2. Copy the **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
3. **Basic Information → App Credentials → Signing Secret** → `SLACK_SIGNING_SECRET`.

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```
Restart the dev server / redeploy.

> Every Slack request is HMAC-verified with `SLACK_SIGNING_SECRET` (v0 scheme,
> 5-minute timestamp window) in `lib/services/slack.ts` — a wrong/missing secret
> makes all commands and buttons return `401 invalid signature`.

### B3. Invite the bot to a channel
The bot can only post where it's a member:
```
/invite @Orçamentos
```
in the channel you'll run `/orcamento` from.

### B4. (Manual alternative to B1)
If you'd rather not use the manifest, create a blank app and set, by hand:
- **OAuth & Permissions → Bot Token Scopes:** `chat:write`, `commands`,
  `app_mentions:read`.
- **Slash Commands → Create:** command `/orcamento`, request URL
  `https://YOUR_DOMAIN/api/slack/commands`.
- **Event Subscriptions → Enable**, request URL
  `https://YOUR_DOMAIN/api/slack/events`, subscribe to bot event `app_mention`.
- **Interactivity & Shortcuts → Enable**, request URL
  `https://YOUR_DOMAIN/api/slack/interactivity`.
- Install to workspace, then copy the tokens as in **B2**.

### B5. Test it
In the invited channel:
```
/orcamento fachada
```
You should see **"Caso aberto: …"**, then the run progress threaded under it, and
finally the drafted quote with **Aprovar e enviar** / **Não enviar** buttons.
Clicking **Aprovar** fires the same approval gate as the web dashboard button.

You can also just **@mention** the bot with a description:
```
@Orçamentos remodelação do escritório, ~40 m2
```

---

## Environment variables — full checklist

| Variable | Channel | Where to get it |
|---|---|---|
| `APP_BASE_URL` | both | Your public HTTPS URL (Vercel domain or tunnel) |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | WhatsApp → API Setup |
| `WHATSAPP_TOKEN` | WhatsApp | API Setup (temp) or System User (permanent) |
| `WHATSAPP_APP_SECRET` | WhatsApp | App Settings → Basic → App Secret |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp | A random string you invent |
| `SLACK_BOT_TOKEN` | Slack | OAuth & Permissions → Bot token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Slack | Basic Information → Signing Secret |

Both integrations **degrade gracefully**: if the WhatsApp/Slack vars are absent,
those code paths no-op (a run still records messages in its own log), so you can
enable one channel without the other.

---

## Don't forget the workflow engine

Channels only *start* work — the durable pipeline that clarifies, prices, and
drafts runs on Inngest. In every environment make sure it's running:
```bash
npm run dev
npx inngest-cli@latest dev     # registers the functions at /api/inngest
```
(Deployed on Vercel, use an Inngest cloud app + signing/event keys instead.)

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| WhatsApp webhook won't verify (no green check) | `WHATSAPP_VERIFY_TOKEN` in `.env.local` ≠ the token typed in Meta; or app not restarted after adding it |
| Inbound WhatsApp does nothing | Not subscribed to the **`messages`** field; or only non-text (image/audio) sent — the route handles `text` only |
| Inbound returns `401 invalid signature` | `WHATSAPP_APP_SECRET` doesn't match the app; unset it to bypass for local `curl` tests |
| Agent doesn't reply on WhatsApp | Run is a **demo** (demos never send), outside the 24h window, or `WHATSAPP_TOKEN`/`PHONE_NUMBER_ID` missing/expired |
| `/orcamento` returns `401` | `SLACK_SIGNING_SECRET` missing/wrong, or clock skew > 5 min |
| Slack command works but nothing posts | Bot not invited to the channel (`/invite @Orçamentos`), or `chat:write` scope missing |
| Slack request URL won't save | App not reachable at that public URL yet (deploy or start the tunnel first) |
| Approve/Reject button does nothing | Interactivity request URL not set to `/api/slack/interactivity` |

---

## How a request flows end-to-end (reference)

1. **WhatsApp in** → `POST /api/whatsapp/inbound` → new phone opens a Case File
   (`quote/request-received`); a known phone with an open case resolves the
   *await-customer* gate (`quote/customer-message`).
2. **Slack in** → `/orcamento` (or @mention) → `createSlackRun` opens a case and
   posts an anchor message; progress threads under it.
3. The Inngest workflow clarifies → prices from the catálogo → drafts the quote.
4. **Review gate** → the Slack **Aprovar** button and the web button both fire
   `quote/human-approval`, resolving one gate.
5. **Out** → the agent sends the quote to the customer on their original channel
   (WhatsApp/email) via `sendToCustomer`.
