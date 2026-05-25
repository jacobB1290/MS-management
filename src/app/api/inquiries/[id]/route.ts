import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { inquiryUpdateSchema } from "@/server/validation/schemas"
import type { TablesUpdate } from "@/lib/database.types"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const parsed = inquiryUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const update: TablesUpdate<"inquiries"> = {}
  if (parsed.data.status !== undefined) update.status = parsed.data.status
  if (parsed.data.topic !== undefined) update.topic = parsed.data.topic
  if (parsed.data.body !== undefined) update.body = parsed.data.body
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("inquiries").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "inquiry.update",
    actorUserId: user.id,
    targetTable: "inquiries",
    targetId: id,
    diff: update,
  })

  return NextResponse.json({ ok: true })
}
