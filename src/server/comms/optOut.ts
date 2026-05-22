import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Central opt-out enforcement. This is the wall — every send path
 * (1:1 SMS, campaign SMS) goes through `assertCanSendSms` before touching
 * Twilio. If a contact is opted out, we refuse, and the caller never even
 * sees the Twilio client.
 */
export type SmsSkipReason = "not_found" | "no_channel" | "opt_out"
export type EmailSkipReason = "not_found" | "no_channel" | "unsubscribed"

export async function assertCanSendSms(
  contactId: string,
): Promise<{ ok: true; phone: string } | { ok: false; reason: SmsSkipReason }> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("contacts")
    .select("phone, sms_opted_out_at")
    .eq("id", contactId)
    .maybeSingle()

  if (error || !data) return { ok: false, reason: "not_found" }
  if (!data.phone) return { ok: false, reason: "no_channel" }
  if (data.sms_opted_out_at) return { ok: false, reason: "opt_out" }
  return { ok: true, phone: data.phone }
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
