import { NextResponse, type NextRequest } from "next/server"
import { revalidateTag } from "next/cache"
import { z } from "zod"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { logAudit } from "@/server/audit"

const schema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]),
  display_name: z.string().trim().min(1).max(80).optional(),
})

/**
 * Invite a staff member. Creates the auth.users row (via admin API) and
 * the matching app_users row. The user receives a magic-link invite email
 * which lands them on /auth/callback and into the console.
 *
 * Admin only.
 */
export async function POST(request: NextRequest) {
  const admin_user = await requireAdmin()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const origin = process.env.APP_BASE_URL ?? "http://localhost:3000"
  const admin = createSupabaseAdminClient()

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    parsed.data.email,
    { redirectTo: `${origin}/auth/callback?next=/inbox` },
  )

  if (inviteErr || !invited.user) {
    return NextResponse.json(
      { error: inviteErr?.message ?? "invite_failed" },
      { status: 500 },
    )
  }

  const { error: roleErr } = await admin
    .from("app_users")
    .upsert(
      {
        user_id: invited.user.id,
        role: parsed.data.role,
        display_name: parsed.data.display_name ?? null,
      },
      { onConflict: "user_id" },
    )

  if (roleErr) {
    return NextResponse.json({ error: roleErr.message }, { status: 500 })
  }

  // New member must be visible to the cached staff lookups right away.
  revalidateTag(`app_users:${invited.user.id}`, "max")
  revalidateTag("app_users", "max")

  await logAudit({
    action: "user.invite",
    actorUserId: admin_user.id,
    targetTable: "app_users",
    targetId: invited.user.id,
    diff: { email: parsed.data.email, role: parsed.data.role },
  })

  return NextResponse.json({ ok: true, user_id: invited.user.id }, { status: 201 })
}
