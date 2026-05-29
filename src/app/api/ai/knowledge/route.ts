import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { knowledgeCreateSchema } from "@/server/validation/schemas"

/**
 * Add a staff-authored church knowledge entry (the AI lookup tool reads these).
 * Any signed-in staffer may add knowledge; website-synced entries are managed
 * by the sync job, never created here. Auth: requireStaff.
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  const parsed = knowledgeCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("church_knowledge")
    .insert({
      title: parsed.data.title,
      body: parsed.data.body,
      source: "staff",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 })
  }

  await logAudit({
    action: "knowledge.create",
    actorUserId: user.id,
    targetTable: "church_knowledge",
    targetId: data.id,
    diff: { title: parsed.data.title, source: "staff" },
  })

  return NextResponse.json({ ok: true, id: data.id })
}
