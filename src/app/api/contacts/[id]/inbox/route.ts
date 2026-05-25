import { NextResponse, type NextRequest } from "next/server"
import { inboxSegmentSchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { isValidStatus, type InboxCategory } from "@/lib/inbox-segments"
import type { TablesUpdate } from "@/lib/database.types"

/**
 * Set a conversation's inbox segment and/or per-conversation status. This is
 * the staff override behind the segment chip + status control in the thread:
 * the human always wins over the auto-classifier.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const parsed = inboxSegmentSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: before } = await admin
    .from("contacts")
    .select("inbox_category, inbox_status")
    .eq("id", id)
    .maybeSingle()
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const nowIso = new Date().toISOString()
  const nextCategory = (parsed.data.category ?? before.inbox_category) as InboxCategory
  const update: TablesUpdate<"contacts"> = {}

  if (parsed.data.category !== undefined && parsed.data.category !== before.inbox_category) {
    update.inbox_category = parsed.data.category
    update.inbox_category_at = nowIso
    // Moving categories drops a status that doesn't exist in the new lifecycle,
    // so the conversation can't carry a "praying" status into Questions.
    if (before.inbox_status && !isValidStatus(parsed.data.category, before.inbox_status)) {
      update.inbox_status = null
      update.inbox_status_at = null
    }
  }

  if (parsed.data.status !== undefined) {
    if (parsed.data.status === null) {
      update.inbox_status = null
      update.inbox_status_at = null
    } else if (isValidStatus(nextCategory, parsed.data.status)) {
      update.inbox_status = parsed.data.status
      update.inbox_status_at = nowIso
    } else {
      return NextResponse.json({ error: "invalid_status" }, { status: 422 })
    }
  }

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const { error } = await admin.from("contacts").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "contact.inbox_update",
    actorUserId: user.id,
    targetTable: "contacts",
    targetId: id,
    diff: { before, update } as never,
  })

  return NextResponse.json({ ok: true })
}
