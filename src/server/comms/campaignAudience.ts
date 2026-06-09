import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

/**
 * Single source of truth for how a campaign's `audience_filter` maps to a
 * contact selection. Supported shapes:
 *   { all: true }        → every contact
 *   { members: true }    → contacts marked as church members
 *   { tags: ["a","b"] }  → contacts whose tags overlap any of these
 * Used by the start route (to stage recipients) and the detail page (to
 * preview the audience size before sending).
 */
export type AudienceMode =
  | { mode: "all" }
  | { mode: "members" }
  | { mode: "tags"; tags: string[] }
  | { mode: "invalid" }

export function resolveAudienceMode(
  filter: Record<string, unknown> | null | undefined,
): AudienceMode {
  const f = filter ?? {}
  if (Array.isArray(f.tags) && f.tags.length > 0) {
    return { mode: "tags", tags: f.tags as string[] }
  }
  if (f.members === true) {
    return { mode: "members" }
  }
  if (f.all === true) {
    return { mode: "all" }
  }
  return { mode: "invalid" }
}

export type RecipientStatus =
  | "queued"
  | "skipped_opt_out"
  | "skipped_unsubscribed"
  | "skipped_no_channel"
  | "skipped_no_consent"

/** The contact fields needed to decide whether a campaign may message them. */
export type AudienceContact = {
  phone: string | null
  email: string | null
  sms_opted_out_at: string | null
  email_unsubscribed_at: string | null
  marketing_consent_at: string | null
  marketing_opted_out_at: string | null
}

export type AudienceRow = AudienceContact & { id: string }

/**
 * Fetch every contact matched by an audience mode — paged, because PostgREST
 * silently caps a response at 1,000 rows. Without paging, a campaign to a
 * larger audience would stage only the first thousand recipients with no
 * error anywhere. The single fetcher serves both the start route (admin
 * client) and the detail-page preview (RLS client), so the preview can never
 * disagree with the send.
 */
const AUDIENCE_PAGE_SIZE = 1000

export async function fetchAudienceContacts(
  client: SupabaseClient<Database>,
  mode: Exclude<AudienceMode, { mode: "invalid" }>,
): Promise<{ rows: AudienceRow[]; error: string | null }> {
  const rows: AudienceRow[] = []
  for (let offset = 0; ; offset += AUDIENCE_PAGE_SIZE) {
    let q = client
      .from("contacts")
      .select(
        "id, phone, email, sms_opted_out_at, email_unsubscribed_at, marketing_consent_at, marketing_opted_out_at",
      )
      .order("id", { ascending: true })
      .range(offset, offset + AUDIENCE_PAGE_SIZE - 1)
    if (mode.mode === "tags") q = q.overlaps("tags", mode.tags)
    else if (mode.mode === "members") q = q.eq("is_member", true)

    const { data, error } = await q
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < AUDIENCE_PAGE_SIZE) break
  }
  return { rows, error: null }
}

/**
 * Classify one contact for a campaign channel — the single source of truth for
 * both staging recipients and the pre-send preview, so the numbers a sender
 * confirms exactly match what is sent.
 *
 * SMS campaigns are proactive marketing: they require express marketing consent
 * and honor both the global STOP (`sms_opted_out_at`) and a marketing-specific
 * opt-out. Email is opt-out only (CAN-SPAM): a working unsubscribe, with no
 * prior express consent required.
 */
export function classifyRecipient(
  channel: "sms" | "email",
  c: AudienceContact,
): RecipientStatus {
  if (channel === "sms") {
    if (!c.phone) return "skipped_no_channel"
    if (c.sms_opted_out_at || c.marketing_opted_out_at) return "skipped_opt_out"
    if (!c.marketing_consent_at) return "skipped_no_consent"
    return "queued"
  }
  if (!c.email) return "skipped_no_channel"
  if (c.email_unsubscribed_at) return "skipped_unsubscribed"
  return "queued"
}

export type AudienceBreakdown = {
  total: number
  queued: number
  skipped_opt_out: number
  skipped_unsubscribed: number
  skipped_no_channel: number
  skipped_no_consent: number
}

/** Tally a matched contact set into per-status counts for the pre-send preview. */
export function summarizeAudience(
  channel: "sms" | "email",
  contacts: AudienceContact[],
): AudienceBreakdown {
  const b: AudienceBreakdown = {
    total: contacts.length,
    queued: 0,
    skipped_opt_out: 0,
    skipped_unsubscribed: 0,
    skipped_no_channel: 0,
    skipped_no_consent: 0,
  }
  for (const c of contacts) b[classifyRecipient(channel, c)] += 1
  return b
}
