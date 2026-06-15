import "server-only"

/**
 * Gmail API client for mirroring the support@ms.church mailbox into the CRM.
 *
 * This is a SEPARATE Google identity from the Events/Calendar OAuth (that token
 * acts as the church gmail.com calendar account; this one acts as the
 * `support@ms.church` Workspace mailbox), so it has its own refresh token —
 * `GOOGLE_GMAIL_REFRESH_TOKEN`, minted with the `gmail.readonly` scope (and
 * `gmail.send` later, for Phase 2). Reuses the shared OAuth client id/secret.
 *
 * Degrades to a no-op when the token is absent (capability ladder, like the rest
 * of the integrations): the sync simply does nothing until Gmail is wired up.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

/** The mailbox we mirror. Defaults to the Reply-To (support@). */
export function gmailAddress(): string {
  return (
    process.env.GOOGLE_GMAIL_ADDRESS ||
    process.env.BREVO_REPLY_TO_EMAIL ||
    "support@ms.church"
  ).toLowerCase()
}

/**
 * The Gmail OAuth client. Gmail uses its OWN dedicated app (a separate GCP
 * project under support@ms.church) so the church email auth isn't tied to the
 * personal calendar account — `GOOGLE_GMAIL_CLIENT_ID/SECRET`, falling back to
 * the shared `GOOGLE_OAUTH_*` client only if the Gmail-specific creds are unset.
 * (The Calendar feature keeps using `GOOGLE_OAUTH_*` directly.)
 */
function gmailClientId(): string | undefined {
  return process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
}
function gmailClientSecret(): string | undefined {
  return process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
}

/** Whether the Gmail mailbox sync is configured (else everything no-ops). */
export function hasGmailSync(): boolean {
  return Boolean(gmailClientId() && gmailClientSecret() && process.env.GOOGLE_GMAIL_REFRESH_TOKEN)
}

/**
 * Whether to route 1:1 sends THROUGH Gmail (needs the gmail.send scope). Explicit
 * opt-in (`GOOGLE_GMAIL_SEND=1`) so it isn't promoted to production until the
 * read-mirror is verified and a gmail.send-scoped token is in place; while off,
 * 1:1 falls back to the Brevo path.
 */
export function hasGmailSend(): boolean {
  const flag = (process.env.GOOGLE_GMAIL_SEND || "").trim().toLowerCase()
  return hasGmailSync() && (flag === "1" || flag === "true" || flag === "yes")
}

// Access tokens last ~1h; cache in module memory and refresh just before expiry.
let cached: { value: string; expiresAt: number } | null = null

export async function getGmailAccessToken(): Promise<string | null> {
  if (!hasGmailSync()) return null
  const now = Date.now()
  if (cached && now < cached.expiresAt - 60_000) return cached.value

  const body = new URLSearchParams({
    client_id: gmailClientId()!,
    client_secret: gmailClientSecret()!,
    refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  })
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`gmail_oauth_token_failed: ${res.status} ${text}`.trim())
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { value: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}

async function gmailFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await getGmailAccessToken()
  if (!token) throw new Error("gmail_not_configured")
  const res = await fetch(`${GMAIL_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`gmail ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/** Send a base64url-encoded RFC 2822 message. Needs the gmail.send scope. */
export async function sendRawMessage(
  raw: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  return gmailFetch("/messages/send", {
    method: "POST",
    body: threadId ? { raw, threadId } : { raw },
  })
}

export interface GmailMessageRef {
  id: string
  threadId: string
}

/** Current mailbox cursor — the historyId to resume incremental sync from. */
export async function getProfile(): Promise<{ emailAddress: string; historyId: string }> {
  return gmailFetch("/profile")
}

interface HistoryResponse {
  history?: { messagesAdded?: { message: GmailMessageRef }[] }[]
  historyId?: string
  nextPageToken?: string
}

/** Incremental: message ids added since `startHistoryId`. */
export async function listHistory(
  startHistoryId: string,
  pageToken?: string,
): Promise<HistoryResponse> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" })
  if (pageToken) params.set("pageToken", pageToken)
  return gmailFetch(`/history?${params.toString()}`)
}

interface ListResponse {
  messages?: GmailMessageRef[]
  nextPageToken?: string
}

/** First-run backfill: recent messages matching a Gmail search query. */
export async function listMessages(query: string, pageToken?: string): Promise<ListResponse> {
  const params = new URLSearchParams({ q: query, maxResults: "100" })
  if (pageToken) params.set("pageToken", pageToken)
  return gmailFetch(`/messages?${params.toString()}`)
}

export interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  internalDate?: string
  payload?: GmailPart
}

export async function getMessage(id: string): Promise<GmailMessage> {
  return gmailFetch(`/messages/${id}?format=full`)
}

/** A header value (case-insensitive), or null. */
export function headerValue(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
}

/** Pull the text/plain and text/html bodies out of a (possibly nested) payload. */
export function extractBodies(payload?: GmailPart): { text: string | null; html: string | null } {
  let text: string | null = null
  let html: string | null = null
  const walk = (part?: GmailPart): void => {
    if (!part) return
    const mime = part.mimeType ?? ""
    if (mime === "text/plain" && part.body?.data && text === null) {
      text = decodeBase64Url(part.body.data)
    } else if (mime === "text/html" && part.body?.data && html === null) {
      html = decodeBase64Url(part.body.data)
    }
    for (const p of part.parts ?? []) walk(p)
  }
  walk(payload)
  return { text, html }
}

/** Extract the bare lowercased address from a `"Name" <addr@x>` header value. */
export function parseEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const angle = value.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : value).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null
}
