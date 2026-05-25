import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { prayerUpdateSchema } from "@/server/validation/schemas"
import type { TablesUpdate } from "@/lib/database.types"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const parsed = prayerUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const update: TablesUpdate<"prayer_requests"> = {}
  if (parsed.data.status !== undefined) update.status = parsed.data.status
  if (parsed.data.assigned_to !== undefined) update.assigned_to = parsed.data.assigned_to
  if (parsed.data.body !== undefined) update.body = parsed.data.body
  if (parsed.data.requester_name !== undefined) update.requester_name = parsed.data.requester_name
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("prayer_requests").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "prayer.update",
    actorUserId: user.id,
    targetTable: "prayer_requests",
    targetId: id,
    diff: update,
  })

  return NextResponse.json({ ok: true })
}
