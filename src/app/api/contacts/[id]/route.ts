import { NextResponse, type NextRequest } from "next/server"
import { contactUpdateSchema } from "@/server/validation/schemas"
import { requireStaff, requireAdmin } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { TablesUpdate } from "@/lib/database.types"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const parsed = contactUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: before } = await admin.from("contacts").select("*").eq("id", id).maybeSingle()
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const update: TablesUpdate<"contacts"> = {}
  if (parsed.data.name !== undefined) update.name = parsed.data.name
  if (parsed.data.phone !== undefined) update.phone = parsed.data.phone
  if (parsed.data.email !== undefined) update.email = parsed.data.email
  if (parsed.data.tags !== undefined) update.tags = parsed.data.tags
  if (parsed.data.language !== undefined) update.language = parsed.data.language
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes

  const { error } = await admin.from("contacts").update(update).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "contact.update",
    actorUserId: user.id,
    targetTable: "contacts",
    targetId: id,
    diff: { before, update } as never,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin_user = await requireAdmin()
  const { id } = await params

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("contacts").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "contact.delete",
    actorUserId: admin_user.id,
    targetTable: "contacts",
    targetId: id,
  })

  return NextResponse.json({ ok: true })
}
