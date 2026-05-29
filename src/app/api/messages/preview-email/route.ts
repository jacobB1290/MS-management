import { NextResponse, type NextRequest } from "next/server"
import { previewEmailSchema } from "@/server/validation/schemas"
import { composePersonalEmail } from "@/server/comms/sendEmail"
import { requireStaff } from "@/server/auth"

/**
 * Render a full HTML preview of a 1:1 email exactly as it will send — same
 * personalization pipeline (sanitize, smart quotes, sign-off with the sender's
 * name, language, the personal shell) via `composePersonalEmail`. Returns the
 * complete email document; the composer drops it into a sandboxed iframe so the
 * preview is byte-faithful to the recipient's view. Does NOT send or write to
 * the DB. Auth: requireStaff.
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = previewEmailSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const composed = await composePersonalEmail({
    contactId: parsed.data.contact_id,
    body: parsed.data.body,
    html: parsed.data.html ?? null,
    sentByUserId: user.id,
  })

  return NextResponse.json({ ok: true, html: composed.previewHtml })
}
