import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { sendOptInInvite } from "@/server/comms/optInInvite"
import { fetchSmsGreetingName } from "@/server/comms/greeting"

/**
 * Send a marketing opt-in invitation to a contact. The contact must be
 * reachable conversationally (recent inbound) and not already opted in or
 * declined — the "opt_in_request" send gate (inside sendOptInInvite) enforces
 * all of that, and stamps marketing_opt_in_requested_at so the gate blocks
 * repeat invites within the conversational window.
 *
 * The message itself asks the contact to reply JOIN, which the inbound webhook
 * turns into express marketing consent. Kept plain ASCII (GSM-7) and greets by
 * first name when we have one; the JOIN ask, "Msg & data rates may apply" and
 * STOP instruction are the disclosures an opt-in CTA needs.
 */
const optInMessage = (name: string | null) =>
  name
    ? `Hi ${name}, it's Morning Star Christian Church! Reply JOIN to get ` +
      "occasional updates and announcements by text. Msg & data rates may " +
      "apply. Reply STOP to opt out anytime."
    : "Morning Star Christian Church here! Reply JOIN to get occasional updates " +
      "and announcements by text. Msg & data rates may apply. Reply STOP to opt out anytime."

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const result = await sendOptInInvite({
    contactId: id,
    body: optInMessage(await fetchSmsGreetingName(id)),
    sentByUserId: user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }

  return NextResponse.json({ ok: true, message_id: result.messageId, mock: result.mock })
}
