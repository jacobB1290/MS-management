import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { sendSms } from "./sendSms"
import { sendOptInInvite } from "./optInInvite"
import { smsGreetingName, fetchSmsGreetingName } from "./greeting"

export type WelcomeSource = "sms_inbound" | "public_form"

// All auto-reply copy is intentionally plain ASCII (straight quotes, no em
// dash, "&" is fine). Curly punctuation forces UCS-2 encoding, which cuts the
// per-segment limit from 160 to 70 chars and silently inflates send cost. Each
// message reads like a person wrote it and greets the contact by first name
// when we have one; the name is charset-guarded in greeting.ts so it can't
// break the 7-bit rule. The carrier-/CTIA-required disclosures ride along where
// they're actually needed: the JOIN invite and confirmation (which reach people
// who never saw the website form) carry program name, "Msg & data rates may
// apply", frequency on the confirmation, and HELP/STOP. The consented ack omits
// them on purpose -- see consentedWelcome.

/**
 * Already-consented arrival: a warm, purely transactional ack -- no opt-in ask
 * and deliberately no STOP/HELP line. This branch only reaches someone who
 * opted in at a disclosed CTA (the website form already shows "Msg & data rates
 * may apply; reply STOP to opt out, HELP for help") or who has declined
 * marketing (so this 1:1 reply is transactional, not marketing). Either way the
 * in-message disclosure isn't required here, and STOP/HELP still work at the
 * carrier via Twilio Advanced Opt-Out. The invite + confirmation, which DO reach
 * people who never saw the form, keep the full disclosure set.
 */
const consentedWelcome = (name: string | null) =>
  (name ? `Hi ${name}, thanks` : "Thanks") +
  " for reaching out to Morning Star Christian Church! Someone will get back to you soon."

/** No marketing consent yet (e.g. texted the number): welcome + JOIN invite. */
const inviteWelcome = (name: string | null) =>
  (name ? `Hi ${name}, welcome` : "Welcome") +
  " to Morning Star Christian Church! Thanks for reaching out, someone will " +
  "reply soon. Want occasional church updates by text too? Just reply JOIN. " +
  "Msg & data rates may apply. Reply STOP to opt out."

/** Acknowledge a fresh JOIN opt-in. The most-scrutinized message, so it keeps
 *  the full disclosure set (program name, frequency, rates, HELP, STOP). */
const joinConfirmation = (name: string | null) =>
  (name ? `You're in, ${name}! You'll` : "You're in! You'll") +
  " now get occasional updates from Morning Star Christian Church. Msg " +
  "frequency varies, msg & data rates may apply. Reply HELP for help or " +
  "STOP to cancel."

/**
 * One-time automatic welcome on a contact's first touch. The caller fires this
 * only when the contact row was just created (the upsert RPC's `created` flag),
 * so it can't double-send across messages.
 *
 * Branches on consent STATE, not the source string, so a form submitted without
 * the opt-in box is handled correctly too:
 *  - already opted in (or has explicitly declined) marketing -> consentedWelcome,
 *    sent as a transactional response to something they initiated, so it doesn't
 *    depend on the conversational window.
 *  - no marketing consent yet -> inviteWelcome via sendOptInInvite, so it counts
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
    .select("name, phone, sms_opted_out_at, marketing_consent_at, marketing_opted_out_at")
    .eq("id", args.contactId)
    .maybeSingle()

  if (!contact?.phone || contact.sms_opted_out_at) return

  const greeting = smsGreetingName(contact.name)

  if (contact.marketing_consent_at || contact.marketing_opted_out_at) {
    await sendSms({
      contactId: args.contactId,
      body: consentedWelcome(greeting),
      context: "transactional_event",
    })
    return
  }

  await sendOptInInvite({
    contactId: args.contactId,
    body: inviteWelcome(greeting),
  })
}

/**
 * Acknowledge a fresh JOIN/SUBSCRIBE opt-in. Fired from the inbound webhook.
 * Transactional (a direct response to their reply); the universal STOP gate in
 * sendSms still blocks a contact who is hard opted out.
 */
export async function sendJoinConfirmation(contactId: string): Promise<void> {
  const greeting = await fetchSmsGreetingName(contactId)
  await sendSms({
    contactId,
    body: joinConfirmation(greeting),
    context: "transactional_event",
  })
}
