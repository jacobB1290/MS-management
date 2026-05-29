import { NextResponse, type NextRequest } from "next/server"
import { aiDraftReplySchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { draftReply } from "@/server/ai/draftReply"

/**
 * Draft or improve a one-to-one SMS reply for the operator. Returns text only
 * for the operator to edit; NEVER sends and NEVER writes to the database.
 * Auth: requireStaff.
 */
export async function POST(request: NextRequest) {
  await requireStaff()

  const parsed = aiDraftReplySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await draftReply({
    contactId: parsed.data.contact_id,
    draft: parsed.data.draft,
  })
  if (!result.ok) {
    const status = result.reason === "disabled" ? 503 : result.reason === "not_found" ? 404 : 400
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status })
  }

  return NextResponse.json({
    ok: true,
    draft: result.draft,
    note: result.note,
    mode: result.mode,
  })
}
