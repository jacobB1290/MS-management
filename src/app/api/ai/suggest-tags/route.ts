import { NextResponse, type NextRequest } from "next/server"
import { aiSuggestTagsSchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { suggestTags } from "@/server/ai/suggestTags"

/**
 * Suggest tags for a contact from its recent thread + the global tag
 * vocabulary. Read-only: returns suggestions for the operator to confirm. The
 * actual write to `contacts.tags` goes through the audited contact PATCH
 * endpoint after the operator accepts. Auth: requireStaff.
 */
export async function POST(request: NextRequest) {
  await requireStaff()

  const parsed = aiSuggestTagsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await suggestTags(parsed.data.contact_id)
  if (!result.ok) {
    const status = result.reason === "disabled" ? 503 : result.reason === "not_found" ? 404 : 400
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status })
  }

  return NextResponse.json({
    ok: true,
    suggestion: result.suggestion,
    current_tags: result.currentTags,
  })
}
