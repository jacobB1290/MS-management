import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { sendSms } from "@/server/comms/sendSms"

/**
 * Send a marketing opt-in invitation to a contact. The contact must be
 * reachable conversationally (recent inbound) and not already opted in or
 * declined — the "opt_in_request" send gate enforces all of that. On success
 * we stamp marketing_opt_in_requested_at so the gate blocks repeat invites
 * within the conversational window.
 *
 * The message itself asks the contact to reply JOIN, which the inbound webhook
 * turns into express marketing consent.
 */
const OPT_IN_MESSAGE =
  "Morning Star Christian Church: reply JOIN to get occasional updates and announcements by text. " +
  "Msg & data rates may apply. Reply STOP to opt out anytime."

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const result = await sendSms({
    contactId: id,
    body: OPT_IN_MESSAGE,
    sentByUserId: user.id,
    context: "opt_in_request",
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }

  // Stamp the request so the gate refuses another invite within the window.
  const admin = createSupabaseAdminClient()
  await admin
    .from("contacts")
    .update({ marketing_opt_in_requested_at: new Date().toISOString() })
    .eq("id", id)

  return NextResponse.json({ ok: true, message_id: result.messageId, mock: result.mock })
}
