import { NextResponse, type NextRequest } from "next/server"
import { sendSmsSchema } from "@/server/validation/schemas"
import { sendSms } from "@/server/comms/sendSms"
import { requireStaff } from "@/server/auth"

/**
 * 1:1 SMS send endpoint. Called from the operator inbox.
 * Auth: requireStaff (admin or member).
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = sendSmsSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await sendSms({
    contactId: parsed.data.contact_id,
    body: parsed.data.body,
    mediaUrl: parsed.data.media_url ?? null,
    sentByUserId: user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, detail: "detail" in result ? result.detail : undefined }, { status: 400 })
  }
  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    provider_sid: result.providerSid,
    mock: result.mock,
  })
}
