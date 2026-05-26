import "server-only"
import type { Tables } from "@/lib/database.types"
import { assertCanSendSms } from "./optOut"

export type OptInMode = "send" | "requested" | "blocked" | null

/**
 * Resolves whether staff can invite a contact to opt in to recurring/marketing
 * messages, and in what state. The express-consent invite only makes sense when
 * the contact is reachable and hasn't already settled either way; the server
 * gate (context "opt_in_request") is the authority on eligibility. Shared by the
 * contact detail page, the inbox contact panel, and the mobile contact sheet so
 * the affordance behaves identically wherever it appears.
 */
export async function resolveOptInMode(
  contact: Pick<
    Tables<"contacts">,
    "id" | "phone" | "sms_opted_out_at" | "marketing_consent_at" | "marketing_opted_out_at"
  >,
): Promise<OptInMode> {
  if (
    !contact.phone ||
    contact.sms_opted_out_at ||
    contact.marketing_consent_at ||
    contact.marketing_opted_out_at
  ) {
    return null
  }
  const gate = await assertCanSendSms(contact.id, "opt_in_request")
  if (gate.ok) return "send"
  if (gate.reason === "opt_in_already_requested") return "requested"
  if (gate.reason === "implied_expired") return "blocked"
  return null
}
