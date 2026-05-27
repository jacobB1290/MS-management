import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { sendSms, type SendSmsResult } from "./sendSms"

/**
 * Canonical "invite a contact to opt in to marketing" path. Sends through the
 * "opt_in_request" send gate (must be conversationally reachable and not
 * already settled either way), then — on a real send — stamps
 * marketing_opt_in_requested_at. That timestamp is the single source of truth
 * the gate and the UI's "Send opt-in request" affordance read to show
 * "Invitation sent. Waiting for a JOIN reply." and to refuse a repeat invite.
 *
 * Shared by the staff button (/api/contacts/[id]/opt-in-request) and the
 * automatic first-contact welcome, so the two can never drift on how an invite
 * is recorded.
 */
export async function sendOptInInvite(args: {
  contactId: string
  body: string
  sentByUserId?: string | null
}): Promise<SendSmsResult> {
  const result = await sendSms({
    contactId: args.contactId,
    body: args.body,
    sentByUserId: args.sentByUserId ?? null,
    context: "opt_in_request",
  })

  if (result.ok) {
    const admin = createSupabaseAdminClient()
    await admin
      .from("contacts")
      .update({ marketing_opt_in_requested_at: new Date().toISOString() })
      .eq("id", args.contactId)
  }

  return result
}
