import "server-only"
import crypto from "node:crypto"

/**
 * Tokenized reply addressing for two-way email. Outbound 1:1 emails set
 * `Reply-To: reply+<contactId>@<INBOUND_EMAIL_DOMAIN>`. When the contact
 * replies, SendGrid Inbound Parse delivers it to that plus-addressed mailbox,
 * and we read the contactId straight out of the local-part — the most reliable
 * way to thread a reply back to the right conversation, with the sender's email
 * as a fallback when the token is missing (older threads, forwards, etc.).
 *
 * `INBOUND_EMAIL_DOMAIN` is the subdomain whose MX points at SendGrid Inbound
 * Parse (e.g. `reply.ms.church`). When it is unset, outbound email still sends
 * but carries no Reply-To, so replies won't auto-thread until DNS is wired up.
 */
const TOKEN_PREFIX = "reply"

export function inboundEmailDomain(): string | null {
  return process.env.INBOUND_EMAIL_DOMAIN?.trim() || null
}

/** The Reply-To address for a contact, or null when no inbound domain is set. */
export function replyToAddress(contactId: string): string | null {
  const domain = inboundEmailDomain()
  if (!domain) return null
  return `${TOKEN_PREFIX}+${contactId}@${domain}`
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pull the contactId out of any recipient address on an inbound email. Scans a
 * list of candidate addresses (the parsed `to`, plus raw envelope/header
 * strings) for `reply+<uuid>@...` and returns the first valid UUID found.
 */
export function parseContactToken(candidates: (string | null | undefined)[]): string | null {
  const re = /reply\+([0-9a-f-]{36})@/i
  for (const c of candidates) {
    if (!c) continue
    const m = c.match(re)
    if (m && UUID_RE.test(m[1])) return m[1].toLowerCase()
  }
  return null
}

/**
 * Extract a bare email address from a header value that may be in the form
 * `"Display Name" <user@example.com>` or just `user@example.com`. Returns the
 * lowercased address, or null if none is found.
 */
export function parseEmailAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const angle = value.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : value).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null
}

// --- One-click unsubscribe (RFC 2369 + RFC 8058) ----------------------------
// Even our 1:1 transactional email carries a List-Unsubscribe header so a
// recipient can opt out from their mail client in one tap. The link is signed
// (HMAC of the contactId) so it can't be guessed/iterated. Falls back to the
// general form HMAC secret when a dedicated one isn't set.

function unsubSecret(): string | null {
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.PUBLIC_FORM_HMAC_SECRET?.trim() ||
    null
  )
}

/** Signature for a contact's unsubscribe link, or null when no secret is set. */
export function signUnsubscribe(contactId: string): string | null {
  const secret = unsubSecret()
  if (!secret) return null
  return crypto.createHmac("sha256", secret).update(contactId).digest("hex").slice(0, 32)
}

/** Constant-time check of an unsubscribe signature. */
export function verifyUnsubscribe(contactId: string, sig: string | null | undefined): boolean {
  const expected = signUnsubscribe(contactId)
  if (!expected || !sig) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * List-Unsubscribe headers for an outbound 1:1 email, or null when not
 * configured (needs APP_BASE_URL + a signing secret). Provides the RFC 8058
 * one-click HTTPS endpoint plus a mailto fallback (handled by the inbound
 * webhook's STOP detection on the subject).
 */
export function unsubscribeHeaders(contactId: string): Record<string, string> | null {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "")
  const sig = signUnsubscribe(contactId)
  if (!base || !sig) return null
  const url = `${base}/api/email/unsubscribe?c=${contactId}&t=${sig}`
  const domain = inboundEmailDomain()
  const mailto = domain
    ? `, <mailto:${TOKEN_PREFIX}+${contactId}@${domain}?subject=unsubscribe>`
    : ""
  return {
    "List-Unsubscribe": `<${url}>${mailto}`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}
