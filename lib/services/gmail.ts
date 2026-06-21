import { env } from '@/lib/env'
import { getRefreshToken } from '@/lib/db/google-credentials'

/**
 * Thin, dependency-free Gmail client (read-only). Handles the OAuth dance
 * (consent URL, code exchange, refresh-token rotation) and the Gmail REST reads
 * the app needs: list candidate threads and fetch one thread's body +
 * attachments. A fetched thread is returned in the same shape as `parseEml`'s
 * `ParsedEmail` (lib/services/doc-parser.ts) so the ingest path is identical.
 *
 * Scope is gmail.readonly (+ openid/email to identify the account) — no sending.
 * The refresh token lives in Supabase Vault (lib/db/google-credentials.ts); this
 * module only ever holds short-lived access tokens in memory.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
// gmail.readonly for the mailbox; openid+email to identify the account (sub/email).
const SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly'

function redirectUri(): string {
  return `${env.appBaseUrl()}/api/gmail/oauth/callback`
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** The Google consent URL. `state` guards against CSRF (verified in callback). */
export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.googleOAuthClientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token every time
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  scope?: string
  expires_in: number
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleOAuthClientId(),
      client_secret: env.googleOAuthClientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleOAuthClientId(),
      client_secret: env.googleOAuthClientSecret(),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

let tokenCache: { token: string; expiresAt: number } | null = null

/** A valid access token for the connected account, refreshed + cached as needed. */
async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token
  const refreshToken = await getRefreshToken()
  const t = await refreshAccessToken(refreshToken)
  tokenCache = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 }
  return t.access_token
}

/** Identify the connected account (stable `sub` + verified email) for storage. */
export async function getUserInfo(
  accessToken: string,
): Promise<{ sub: string | null; email: string | null }> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return { sub: null, email: null }
  const data = (await res.json()) as { sub?: string; email?: string }
  return { sub: data.sub ?? null, email: data.email ?? null }
}

/** Fallback email via Gmail profile (if userinfo is unavailable). */
export async function getProfileEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GMAIL_API}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { emailAddress?: string }
  return data.emailAddress ?? null
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function api<T>(path: string): Promise<T> {
  const token = await getAccessToken()
  let res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    // Token may have just expired — drop the cache and retry once.
    tokenCache = null
    const fresh = await getAccessToken()
    res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${fresh}` },
    })
  }
  if (!res.ok) throw new Error(`gmail ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

interface GmailHeader {
  name: string
  value: string
}
interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: GmailPart[]
}
interface GmailMessage {
  id: string
  threadId: string
  snippet?: string
  payload?: GmailPart
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseAddress(value: string): { name?: string; address?: string } {
  const m = value.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/)
  if (m) return { name: m[1]?.trim() || undefined, address: m[2].trim() }
  const v = value.trim()
  return v.includes('@') ? { address: v } : { name: v || undefined }
}

function b64urlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasAttachmentPart(part: GmailPart | undefined): boolean {
  if (!part) return false
  if (part.filename && part.body?.attachmentId) return true
  return (part.parts ?? []).some(hasAttachmentPart)
}

export interface ThreadSummary {
  threadId: string
  subject: string
  from: string
  date: string
  snippet: string
  hasAttachment: boolean
}

/** List candidate threads matching `query` (e.g. `has:attachment newer_than:1y`). */
export async function listThreads(query: string, max = 15): Promise<ThreadSummary[]> {
  const list = await api<{ messages?: { id: string; threadId: string }[] }>(
    `/users/me/messages?maxResults=${max * 2}&q=${encodeURIComponent(query)}`,
  )
  const seen = new Set<string>()
  const pick: { id: string; threadId: string }[] = []
  for (const m of list.messages ?? []) {
    if (seen.has(m.threadId)) continue
    seen.add(m.threadId)
    pick.push(m)
    if (pick.length >= max) break
  }
  const summaries = await Promise.all(
    pick.map(async (m) => {
      const msg = await api<GmailMessage>(
        `/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      )
      const h = msg.payload?.headers
      return {
        threadId: m.threadId,
        subject: header(h, 'Subject') || '(no subject)',
        from: header(h, 'From'),
        date: header(h, 'Date'),
        snippet: msg.snippet ?? '',
        hasAttachment: hasAttachmentPart(msg.payload),
      }
    }),
  )
  return summaries
}

export interface ParsedThread {
  threadId: string
  permalink: string
  from: { name?: string; address?: string }
  subject: string
  text: string
  attachments: { filename: string; mimeType: string; bytes: Uint8Array }[]
}

/** Skip inline images / signature logos; keep real submission documents. */
function isNoiseAttachment(part: GmailPart): boolean {
  const disp = header(part.headers, 'Content-Disposition').toLowerCase()
  const mime = (part.mimeType ?? '').toLowerCase()
  const size = part.body?.size ?? 0
  if (disp.includes('inline')) return true
  if (mime.startsWith('image/') && size < 50_000) return true
  return false
}

/** Fetch one thread: sender, body (cover note), and real document attachments. */
export async function getThread(threadId: string): Promise<ParsedThread> {
  const thread = await api<{ messages: GmailMessage[] }>(
    `/users/me/threads/${threadId}?format=full`,
  )
  const messages = thread.messages ?? []
  const first = messages[0]
  const fromHeader = header(first?.payload?.headers, 'From')
  const subject = header(first?.payload?.headers, 'Subject') || '(no subject)'

  let textPlain = ''
  let textHtml = ''
  const refs: { filename: string; mimeType: string; messageId: string; attachmentId: string }[] = []

  const walk = (part: GmailPart | undefined, messageId: string) => {
    if (!part) return
    if (part.filename && part.body?.attachmentId) {
      if (!isNoiseAttachment(part)) {
        refs.push({
          filename: part.filename,
          mimeType: part.mimeType ?? 'application/octet-stream',
          messageId,
          attachmentId: part.body.attachmentId,
        })
      }
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      textPlain += new TextDecoder().decode(b64urlToBytes(part.body.data)) + '\n'
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      textHtml += new TextDecoder().decode(b64urlToBytes(part.body.data)) + '\n'
    }
    for (const child of part.parts ?? []) walk(child, messageId)
  }

  // Body + cover note: the first (original submission) message. Attachments:
  // gather across every message in the thread.
  walk(first?.payload, first?.id ?? '')
  for (const m of messages.slice(1)) walk(m.payload, m.id)

  const resolved = await Promise.all(
    refs.map(async (ref) => {
      const a = await api<{ data?: string }>(
        `/users/me/messages/${ref.messageId}/attachments/${ref.attachmentId}`,
      )
      return a.data
        ? { filename: ref.filename, mimeType: ref.mimeType, bytes: b64urlToBytes(a.data) }
        : null
    }),
  )

  return {
    threadId,
    permalink: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    from: parseAddress(fromHeader),
    subject,
    text: (textPlain.trim() || stripHtml(textHtml)).trim(),
    attachments: resolved.filter((a): a is NonNullable<typeof a> => a !== null),
  }
}

export interface ThreadMeta {
  threadId: string
  permalink: string
  from: { name?: string; address?: string }
  subject: string
  text: string
  attachments: { filename: string; mimeType: string; sizeBytes: number }[]
}

/**
 * Lightweight thread read for the submission composer: sender, body (cover note),
 * and attachment names + sizes — WITHOUT downloading the attachment bytes. Lets the
 * UI hydrate broker fields and list the documents instantly; the bytes are fetched
 * later by `getThread` only when the submission actually runs.
 */
export async function getThreadMeta(threadId: string): Promise<ThreadMeta> {
  const thread = await api<{ messages: GmailMessage[] }>(
    `/users/me/threads/${threadId}?format=full`,
  )
  const messages = thread.messages ?? []
  const first = messages[0]
  const fromHeader = header(first?.payload?.headers, 'From')
  const subject = header(first?.payload?.headers, 'Subject') || '(no subject)'

  let textPlain = ''
  let textHtml = ''
  const attachments: { filename: string; mimeType: string; sizeBytes: number }[] = []

  const walk = (part: GmailPart | undefined) => {
    if (!part) return
    if (part.filename && part.body?.attachmentId) {
      if (!isNoiseAttachment(part)) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType ?? 'application/octet-stream',
          sizeBytes: part.body.size ?? 0,
        })
      }
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      textPlain += new TextDecoder().decode(b64urlToBytes(part.body.data)) + '\n'
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      textHtml += new TextDecoder().decode(b64urlToBytes(part.body.data)) + '\n'
    }
    for (const child of part.parts ?? []) walk(child)
  }

  walk(first?.payload)
  for (const m of messages.slice(1)) walk(m.payload)

  return {
    threadId,
    permalink: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    from: parseAddress(fromHeader),
    subject,
    text: (textPlain.trim() || stripHtml(textHtml)).trim(),
    attachments,
  }
}
