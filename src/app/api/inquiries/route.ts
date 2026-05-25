import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { inquiryCreateSchema } from "@/server/validation/schemas"

export async function POST(request: NextRequest) {
  const user = await requireStaff()
  const parsed = inquiryCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("inquiries")
    .insert({
      body: parsed.data.body,
      topic: parsed.data.topic ?? null,
      requester_name: parsed.data.requester_name ?? null,
      contact_id: parsed.data.contact_id ?? null,
    })
    .select("id")
    .single()
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 })
  }

  await logAudit({
    action: "inquiry.create",
    actorUserId: user.id,
    targetTable: "inquiries",
    targetId: data.id,
    diff: { contact_id: parsed.data.contact_id ?? null, topic: parsed.data.topic ?? null },
  })

  return NextResponse.json({ ok: true, id: data.id })
}
