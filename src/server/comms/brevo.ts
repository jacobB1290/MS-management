import "server-only"

/**
 * Brevo (formerly Sendinblue) REST API v3 client. The ONE place that talks to
 * Brevo, mirroring how `sendSms` wraps Twilio: every email — 1:1 transactional
 * and bulk campaign — flows through these helpers. Degrades to a logged mock
 * when `BREVO_API_KEY` is unset, so the inbox, campaigns, and the Playwright
 * harness all run without a provisioned Brevo account (exactly like the old
 * SendGrid mock mode).
 *
 * Two Brevo facts are load-bearing and easy to get wrong:
 *   1. Auth is the literal `api-key` header — NOT `Authorization: Bearer`.
 *   2. Brevo does NOT sign webhooks. The webhook is authenticated by a shared
 *      URL token instead — see src/server/webhooks/verify.ts.
 *
 * Free-tier limits this client respects by design: 300 emails/day shared across
 * transactional + campaign, and ~100 requests/hour on campaign/management
 * endpoints. So blasts hand a LIST to Brevo (one call) rather than looping a
 * send per recipient, and the audience is bulk-imported in a single request.
 */

const BASE = "https://api.brevo.com/v3"

/** True once a real key is present; otherwise callers fall back to mock mode. */
export function brevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY)
}

/** The verified sender every email goes out as. */
export function brevoFrom(): { email: string; name: string } {
  return {
    email: process.env.BREVO_FROM_EMAIL || "newsletter@ms.church",
    name: process.env.BREVO_FROM_NAME || "Morning Star Church",
  }
}

/**
 * Where recipient replies go. By design this is the Google Workspace mailbox
 * (`support@ms.church`): Brevo sends, Google receives. Replies are answered by
 * humans in Gmail, not ingested into the CRM.
 */
export function brevoReplyTo(): string {
  return process.env.BREVO_REPLY_TO_EMAIL || "support@ms.church"
}

export type BrevoResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string }

/**
 * Low-level request with retry/backoff on 429 + 5xx, honoring `Retry-After`.
 * Returns a typed result rather than throwing, so call sites can degrade
 * gracefully and record the provider error on the message/campaign row.
 */
async function brevoFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<BrevoResult<T>> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { ok: false, status: 0, error: "BREVO_API_KEY not set" }

  const maxAttempts = 4
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "api-key": apiKey,
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      })
    } catch (err) {
      if (attempt === maxAttempts) {
        return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
      }
      await sleep(backoffMs(attempt, null))
      continue
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) {
        const text = await res.text().catch(() => "")
        return { ok: false, status: res.status, error: `Brevo ${res.status}: ${text.slice(0, 300)}` }
      }
      await sleep(backoffMs(attempt, res.headers.get("retry-after")))
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, status: res.status, error: `Brevo ${res.status}: ${text.slice(0, 300)}` }
    }

    // 201 returns a body; 204 (e.g. PUT update, sendNow) does not.
    if (res.status === 204) return { ok: true, status: 204, data: undefined as T }
    const data = (await res.json().catch(() => ({}))) as T
    return { ok: true, status: res.status, data }
  }
  return { ok: false, status: 0, error: "exhausted retries" }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 16000)
  }
  return Math.min(2 ** attempt * 250, 8000) // 0.5s, 1s, 2s, 4s (capped)
}

// --- Transactional email (1:1 personal replies) -----------------------------

export interface BrevoTransactionalEmail {
  to: { email: string; name?: string }[]
  subject: string
  htmlContent?: string
  textContent?: string
  templateId?: number
  params?: Record<string, unknown>
  replyTo?: { email: string; name?: string }
  attachment?: { name: string; content: string }[]
  /** Title-Case custom headers. Carries Idempotency-Key for safe retries. */
  headers?: Record<string, string>
  tags?: string[]
}

export function sendTransactionalEmail(
  email: BrevoTransactionalEmail,
): Promise<BrevoResult<{ messageId?: string }>> {
  return brevoFetch("/smtp/email", {
    method: "POST",
    body: { sender: brevoFrom(), ...email },
  })
}

// --- Contacts, folders & lists ----------------------------------------------

export function createFolder(name: string): Promise<BrevoResult<{ id: number }>> {
  return brevoFetch("/contacts/folders", { method: "POST", body: { name } })
}

export function createList(args: {
  name: string
  folderId: number
}): Promise<BrevoResult<{ id: number }>> {
  return brevoFetch("/contacts/lists", { method: "POST", body: args })
}

/**
 * Bulk upsert + list assignment in ONE async call (returns a processId to poll
 * via getProcess). One request keeps us well under the contacts rate limit and
 * the ~100/hr management cap even for a few-hundred-contact congregation list.
 */
export function importContacts(args: {
  listIds: number[]
  jsonBody: { email: string; attributes?: Record<string, unknown> }[]
}): Promise<BrevoResult<{ processId: number }>> {
  return brevoFetch("/contacts/import", {
    method: "POST",
    body: {
      listIds: args.listIds,
      updateExistingContacts: true,
      emptyContactsAttributes: false,
      jsonBody: args.jsonBody,
    },
  })
}

/** Poll an async process (e.g. a contact import). status: queued|in_process|completed. */
export function getProcess(
  processId: number,
): Promise<BrevoResult<{ status?: string }>> {
  return brevoFetch(`/processes/${processId}`)
}

// --- Email campaigns (bulk blasts) ------------------------------------------

export function createEmailCampaign(args: {
  name: string
  subject: string
  templateId: number
  listIds: number[]
  replyTo?: string
  scheduledAt?: string | null
}): Promise<BrevoResult<{ id: number }>> {
  return brevoFetch("/emailCampaigns", {
    method: "POST",
    body: {
      name: args.name,
      subject: args.subject,
      sender: brevoFrom(),
      type: "classic",
      templateId: args.templateId,
      recipients: { listIds: args.listIds },
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
    },
  })
}

/** Queue an existing draft campaign for immediate send. */
export function sendCampaignNow(campaignId: number): Promise<BrevoResult<void>> {
  return brevoFetch(`/emailCampaigns/${campaignId}/sendNow`, { method: "POST" })
}

export interface BrevoCampaignGlobalStats {
  sent?: number
  delivered?: number
  hardBounces?: number
  softBounces?: number
  viewed?: number
  uniqueViews?: number
  clickers?: number
  uniqueClicks?: number
  unsubscriptions?: number
  complaints?: number
}

export function getEmailCampaign(campaignId: number): Promise<
  BrevoResult<{ status?: string; statistics?: { globalStats?: BrevoCampaignGlobalStats } }>
> {
  return brevoFetch(`/emailCampaigns/${campaignId}`)
}

// --- Templates (the campaign composer's picker) -----------------------------

export interface BrevoTemplateSummary {
  id: number
  name: string
  subject?: string
  isActive?: boolean
  modifiedAt?: string
}

/** All reusable designs live under one store, despite the `smtp/` path. */
export function listTemplates(): Promise<BrevoResult<{ templates?: BrevoTemplateSummary[] }>> {
  return brevoFetch("/smtp/templates?limit=200&sort=desc")
}
