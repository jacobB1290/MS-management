import { NextResponse, type NextRequest } from "next/server"
import { campaignCreateSchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { Json, TablesInsert } from "@/lib/database.types"

export async function POST(request: NextRequest) {
  const user = await requireStaff()
  const parsed = campaignCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }
  const data = parsed.data

  const admin = createSupabaseAdminClient()
  const row: TablesInsert<"campaigns"> =
    data.channel === "sms"
      ? {
          name: data.name,
          channel: data.channel,
          body: data.body,
          media_url: data.media_url ?? null,
          audience_filter: data.audience_filter as Json,
          scheduled_at: data.scheduled_at ?? null,
          status: data.scheduled_at ? "scheduled" : "draft",
          event_id: data.event_id ?? null,
          created_by: user.id,
        }
      : {
          name: data.name,
          channel: data.channel,
          brevo_template_id: data.brevo_template_id,
          email_subject: data.email_subject,
          audience_filter: data.audience_filter as Json,
          scheduled_at: data.scheduled_at ?? null,
          status: data.scheduled_at ? "scheduled" : "draft",
          event_id: data.event_id ?? null,
          created_by: user.id,
        }

  const { data: created, error } = await admin
    .from("campaigns")
    .insert(row)
    .select("id")
    .single()

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 })
  }

  await logAudit({
    action: "campaign.create",
    actorUserId: user.id,
    targetTable: "campaigns",
    targetId: created.id,
    diff: data as Json,
  })

  return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
}
