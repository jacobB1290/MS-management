import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { knowledgeUpdateSchema } from "@/server/validation/schemas"

/**
 * Edit or remove a staff-authored church knowledge entry. Website-synced
 * entries are owned by the sync job, so they're read-only here (the sync keeps
 * them in step with ms.church). Auth: requireStaff.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const parsed = knowledgeUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: existing } = await admin
    .from("church_knowledge")
    .select("source")
    .eq("id", id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (existing.source !== "staff") {
    return NextResponse.json({ error: "website_managed" }, { status: 400 })
  }

  const patch: { title?: string; body?: string } = {}
  if (parsed.data.title !== undefined) patch.title = parsed.data.title
  if (parsed.data.body !== undefined) patch.body = parsed.data.body

  const { error } = await admin.from("church_knowledge").update(patch).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "knowledge.update",
    actorUserId: user.id,
    targetTable: "church_knowledge",
    targetId: id,
    diff: patch,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const admin = createSupabaseAdminClient()
  const { data: existing } = await admin
    .from("church_knowledge")
    .select("source")
    .eq("id", id)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (existing.source !== "staff") {
    return NextResponse.json({ error: "website_managed" }, { status: 400 })
  }

  const { error } = await admin.from("church_knowledge").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "knowledge.delete",
    actorUserId: user.id,
    targetTable: "church_knowledge",
    targetId: id,
  })

  return NextResponse.json({ ok: true })
}
