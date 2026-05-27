import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Central opt-out enforcement. This is the wall — every send path
 * (1:1 SMS, campaign SMS) goes through `assertCanSendSms` before touching
 * Twilio. If a contact is opted out, we refuse, and the caller never even
 * sees the Twilio client.
 */
export type SendContext =
  | "conversational_reply"
  | "marketing_newsletter"
  | "marketing_promotional"
  | "opt_in_request"
  | "transactional_event"

export type SmsSkipReason =
  | "not_found"
  | "no_channel"
  | "opt_out"
  | "implied_expired"
  | "no_marketing_consent"
  | "marketing_opted_out"
  | "already_opted_in"
  | "opt_in_already_requested"
  | "context_unsupported"
export type EmailSkipReason = "not_found" | "no_channel" | "unsubscribed"

/**
 * Conversational (implied) consent window: staff may reply for this many days
 * after the contact's last inbound, refreshing on every inbound. Once it
 * lapses, only express marketing consent keeps the contact reachable. One
 * constant so it is easy to change; confirm the duration with counsel.
 */
export const CONVERSATIONAL_WINDOW_DAYS = 90

type Admin = ReturnType<typeof createSupabaseAdminClient>

function withinDays(ts: string, days: number): boolean {
  return Date.now() - new Date(ts).getTime() < days * 24 * 60 * 60 * 1000
}

/** True when the contact sent an inbound message inside the conversational window. */
async function conversationActive(admin: Admin, contactId: string): Promise<boolean> {
  const cutoff = new Date(
    Date.now() - CONVERSATIONAL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("contact_id", contactId)
    .eq("direction", "in")
    .gte("created_at", cutoff)
    .limit(1)
  return Boolean(data && data.length > 0)
}

/**
 * The single send gate. Every outbound SMS — 1:1 or campaign — passes through
 * here tagged with the message CONTEXT, and the matching consent rule is
 * applied automatically. Staff never pick a rule, only an action (which fixes
 * the context). STOP is the universal hard stop, checked first.
 */
export async function assertCanSendSms(
  contactId: string,
  context: SendContext = "conversational_reply",
): Promise<{ ok: true; phone: string } | { ok: false; reason: SmsSkipReason }> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("contacts")
    .select(
      "phone, sms_opted_out_at, marketing_consent_at, marketing_opted_out_at, marketing_opt_in_requested_at",
    )
    .eq("id", contactId)
    .maybeSingle()

  if (error || !data) return { ok: false, reason: "not_found" }
  if (!data.phone) return { ok: false, reason: "no_channel" }
  if (data.sms_opted_out_at) return { ok: false, reason: "opt_out" } // universal hard stop

  switch (context) {
    case "marketing_newsletter":
    case "marketing_promotional":
      if (data.marketing_opted_out_at) return { ok: false, reason: "marketing_opted_out" }
      if (!data.marketing_consent_at) return { ok: false, reason: "no_marketing_consent" }
      return { ok: true, phone: data.phone }

    case "opt_in_request": {
      if (data.marketing_consent_at) return { ok: false, reason: "already_opted_in" }
      if (data.marketing_opted_out_at) return { ok: false, reason: "marketing_opted_out" }
      if (!(await conversationActive(admin, contactId))) return { ok: false, reason: "implied_expired" }
      if (
        data.marketing_opt_in_requested_at &&
        withinDays(data.marketing_opt_in_requested_at, CONVERSATIONAL_WINDOW_DAYS)
      ) {
        return { ok: false, reason: "opt_in_already_requested" }
      }
      return { ok: true, phone: data.phone }
    }

    case "transactional_event":
      // Transactional: a direct, one-off response to something this contact
      // initiated (e.g. an RSVP). Informational rather than marketing, so it
      // needs no marketing consent; the only hard block is a global STOP,
      // already handled above. The originating record is the consent basis,
      // and the UI only sends these from that workflow.
      return { ok: true, phone: data.phone }

    case "conversational_reply":
    default:
      if (data.marketing_consent_at) return { ok: true, phone: data.phone }
      if (await conversationActive(admin, contactId)) return { ok: true, phone: data.phone }
      return { ok: false, reason: "implied_expired" }
  }
}

export async function assertCanSendEmail(
  contactId: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: EmailSkipReason }> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("contacts")
    .select("email, email_unsubscribed_at")
    .eq("id", contactId)
    .maybeSingle()

  if (error || !data) return { ok: false, reason: "not_found" }
  if (!data.email) return { ok: false, reason: "no_channel" }
  if (data.email_unsubscribed_at) return { ok: false, reason: "unsubscribed" }
  return { ok: true, email: data.email }
}

/**
 * Detect carrier opt-out keywords in an inbound message. Twilio handles
 * carrier-level blocking exactly, but we mirror the keyword set so our DB
 * stays in sync — including looser matches like "Stop please" that the
 * regulator-facing record should reflect even if Twilio also catches them.
 *
 * Match rules:
 *   1. Exact keyword (case-insensitive, whole-message): always treated as the keyword.
 *   2. First word is a keyword and the message is ≤6 words: treated as the keyword.
 * Longer messages with a keyword embedded (e.g. "stop by tomorrow") are ignored.
 */
const STOP_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT",
])
const START_KEYWORDS = new Set([
  "START", "YES", "UNSTOP",
])

export function detectOptOutKeyword(
  body: string | null | undefined,
): "stop" | "start" | null {
  if (!body) return null
  const trimmed = body.trim().toUpperCase()
  if (!trimmed) return null

  // Exact match
  if (STOP_KEYWORDS.has(trimmed)) return "stop"
  if (START_KEYWORDS.has(trimmed)) return "start"

  // First-token short-message match: covers "Stop please", "STOP NOW",
  // "Please STOP" we already missed, but capped at 6 tokens so we don't
  // misread "stop by tomorrow with the kids".
  const tokens = trimmed.split(/[\s.,!?;:]+/).filter(Boolean)
  if (tokens.length > 0 && tokens.length <= 6) {
    const first = tokens[0]
    if (STOP_KEYWORDS.has(first)) return "stop"
    if (START_KEYWORDS.has(first)) return "start"
    // "Please stop" — second-token check
    if (tokens.length >= 2 && /^(PLEASE|PLZ|PLS)$/.test(first)) {
      const second = tokens[1]
      if (STOP_KEYWORDS.has(second)) return "stop"
      if (START_KEYWORDS.has(second)) return "start"
    }
  }
  return null
}

/**
 * Marketing opt-in keyword. Replying JOIN/SUBSCRIBE is an explicit express
 * consent to recurring messages (newsletters, campaigns). Kept separate from
 * START (which only lifts a STOP), so a casual "yes" never silently enrolls
 * someone in marketing.
 */
const MARKETING_JOIN_KEYWORDS = new Set(["JOIN", "SUBSCRIBE"])

export function detectMarketingJoin(body: string | null | undefined): boolean {
  if (!body) return false
  const trimmed = body.trim().toUpperCase()
  if (!trimmed) return false
  if (MARKETING_JOIN_KEYWORDS.has(trimmed)) return true
  const tokens = trimmed.split(/[\s.,!?;:]+/).filter(Boolean)
  return tokens.length > 0 && tokens.length <= 4 && MARKETING_JOIN_KEYWORDS.has(tokens[0])
}

/**
 * Help keyword. Twilio's Advanced Opt-Out answers HELP/INFO at the carrier
 * level, so the CRM must NOT also auto-reply (e.g. fire a first-contact
 * welcome) when one of these is the inbound. We only detect it to suppress our
 * own replies; the message is still stored and staff are still notified.
 */
const HELP_KEYWORDS = new Set(["HELP", "INFO"])

export function detectHelpKeyword(body: string | null | undefined): boolean {
  if (!body) return false
  const trimmed = body.trim().toUpperCase()
  if (!trimmed) return false
  if (HELP_KEYWORDS.has(trimmed)) return true
  const tokens = trimmed.split(/[\s.,!?;:]+/).filter(Boolean)
  return tokens.length > 0 && tokens.length <= 4 && HELP_KEYWORDS.has(tokens[0])
}
