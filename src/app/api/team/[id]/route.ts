import { NextResponse, type NextRequest } from "next/server"
import { revalidateTag } from "next/cache"
import { z } from "zod"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { logAudit } from "@/server/audit"

const updateSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  display_name: z.string().trim().min(1).max(80).optional().nullable(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin_user = await requireAdmin()
  const { id } = await params
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: before } = await admin
    .from("app_users")
    .select("*")
    .eq("user_id", id)
    .maybeSingle()
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { error } = await admin
    .from("app_users")
    .update({
      role: parsed.data.role ?? before.role,
      display_name: parsed.data.display_name ?? before.display_name,
    })
    .eq("user_id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Drop the cached role/display-name immediately (requireStaff and the
  // thread-pane staff directory both read through these tags).
  revalidateTag(`app_users:${id}`, "max")
  revalidateTag("app_users", "max")

  await logAudit({
    action: "user.role_change",
    actorUserId: admin_user.id,
    targetTable: "app_users",
    targetId: id,
    diff: { before, update: parsed.data } as never,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin_user = await requireAdmin()
  const { id } = await params
  if (id === admin_user.id) {
    return NextResponse.json({ error: "cannot_remove_self" }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  // Remove the app_users mapping; do NOT delete the auth.users record (keeps
  // their audit trail intact). The user can still sign in but will hit
  // /access-denied.
  const { error } = await admin.from("app_users").delete().eq("user_id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Their cached staff row must die NOW — a removed user keeping a warm
  // 60-second requireStaff cache is an access-revocation hole.
  revalidateTag(`app_users:${id}`, "max")
  revalidateTag("app_users", "max")

  await logAudit({
    action: "user.role_change",
    actorUserId: admin_user.id,
    targetTable: "app_users",
    targetId: id,
    diff: { removed: true } as never,
  })

  return NextResponse.json({ ok: true })
}
