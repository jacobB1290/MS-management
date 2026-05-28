import { NextResponse, type NextRequest } from "next/server"
import { sendEmailSchema } from "@/server/validation/schemas"
import { sendDirectEmail } from "@/server/comms/sendEmail"
import { requireStaff } from "@/server/auth"

/**
 * 1:1 email send endpoint. Called from the operator inbox when the active
 * channel is email. Auth: requireStaff (admin or member). Mirrors
 * /api/messages/send (SMS) — opt-out enforcement and the message-row write
 * live inside sendDirectEmail.
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = sendEmailSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await sendDirectEmail({
    contactId: parsed.data.contact_id,
    subject: parsed.data.subject,
    body: parsed.data.body,
    html: parsed.data.html ?? null,
    attachments: parsed.data.attachments,
    sentByUserId: user.id,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, detail: "detail" in result ? result.detail : undefined },
      { status: 400 },
    )
  }
  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    provider_id: result.providerId,
    mock: result.mock,
  })
}
