import "server-only"

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
