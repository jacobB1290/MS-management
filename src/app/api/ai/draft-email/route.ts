import { NextResponse, type NextRequest } from "next/server"
import { aiDraftEmailSchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { draftEmail } from "@/server/ai/draftEmail"

/**
 * Draft a fresh 1:1 email or beautify the operator's plain-text draft into a
 * polished, sanitized HTML fragment (plus a subject). Returns content only for
 * the operator to preview and send; NEVER sends and NEVER writes to the
 * database. Auth: requireStaff. 503 when AI is disabled (incl. demo/no key).
 */
export async function POST(request: NextRequest) {
  await requireStaff()

  const parsed = aiDraftEmailSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await draftEmail({
    contactId: parsed.data.contact_id,
    draft: parsed.data.draft,
  })
  if (!result.ok) {
    const status =
      result.reason === "disabled" ? 503 : result.reason === "not_found" ? 404 : 400
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status })
  }

  return NextResponse.json({
    ok: true,
    subject: result.subject,
    html: result.html,
    text: result.text,
    mode: result.mode,
  })
}
