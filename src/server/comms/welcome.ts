import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { sendSms } from "./sendSms"
import { sendOptInInvite } from "./optInInvite"

export type WelcomeSource = "sms_inbound" | "public_form"

// All auto-reply copy is intentionally plain ASCII (straight quotes, no em
// dash, "&" is fine). Curly punctuation forces UCS-2 encoding, which cuts the
// per-segment limit from 160 to 70 chars and silently inflates send cost.

/** Already-consented arrival (e.g. form opt-in box): warm ack, no opt-in ask. */
const CONSENTED_WELCOME =
  "Thanks for contacting Morning Star Christian Church! We got your message " +
  "and someone will reply soon. Reply STOP to opt out of texts."

/** No marketing consent yet (e.g. texted the number): welcome + JOIN invite. */
const INVITE_WELCOME =
  "Welcome to Morning Star Christian Church! Thanks for reaching out, someone " +
  "will reply soon. To also get occasional church updates by text, reply JOIN. " +
  "Msg & data rates may apply. Reply STOP to opt out."

/** Acknowledge a fresh JOIN opt-in. */
const JOIN_CONFIRMATION =
  "You're subscribed to Morning Star Christian Church texts. Msg frequency " +
  "varies. Msg & data rates may apply. Reply STOP to cancel."

/**
 * One-time automatic welcome on a contact's first touch. The caller fires this
 * only when the contact row was just created (the upsert RPC's `created` flag),
 * so it can't double-send across messages.
 *
 * Branches on consent STATE, not the source string, so a form submitted without
 * the opt-in box is handled correctly too:
 *  - already opted in (or has explicitly declined) marketing -> CONSENTED_WELCOME,
 *    sent as a transactional response to something they initiated, so it doesn't
 *    depend on the conversational window.
 *  - no marketing consent yet -> INVITE_WELCOME via sendOptInInvite, so it counts
 *    as an opt-in request: marketing_opt_in_requested_at is stamped and the staff
 *    "Send opt-in request" affordance flips to "waiting for a JOIN reply". The
 *    opt_in_request gate still applies, so this no-ops safely when there is no
 *    conversational basis to ask (e.g. a form with no message and no opt-in).
 *
 * Skips silently when the contact has no phone or is opted out of SMS.
 */
export async function sendWelcome(args: {
  contactId: string
  source: WelcomeSource
}): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { data: contact } = await admin
    .from("contacts")
    .select("phone, sms_opted_out_at, marketing_consent_at, marketing_opted_out_at")
    .eq("id", args.contactId)
    .maybeSingle()

  if (!contact?.phone || contact.sms_opted_out_at) return

  if (contact.marketing_consent_at || contact.marketing_opted_out_at) {
    await sendSms({
      contactId: args.contactId,
      body: CONSENTED_WELCOME,
      context: "transactional_event",
    })
    return
  }

  await sendOptInInvite({
    contactId: args.contactId,
    body: INVITE_WELCOME,
  })
}

/**
 * Acknowledge a fresh JOIN/SUBSCRIBE opt-in. Fired from the inbound webhook.
 * Transactional (a direct response to their reply); the universal STOP gate in
 * sendSms still blocks a contact who is hard opted out.
 */
export async function sendJoinConfirmation(contactId: string): Promise<void> {
  await sendSms({
    contactId,
    body: JOIN_CONFIRMATION,
    context: "transactional_event",
  })
}
