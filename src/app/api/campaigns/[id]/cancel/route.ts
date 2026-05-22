import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const admin = createSupabaseAdminClient()
  const { data: campaign } = await admin
    .from("campaigns")
    .select("status")
    .eq("id", id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (campaign.status !== "sending" && campaign.status !== "scheduled" && campaign.status !== "draft") {
    return NextResponse.json({ error: "invalid_status", status: campaign.status }, { status: 400 })
  }

  await admin
    .from("campaigns")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)

  await logAudit({
    action: "campaign.cancel",
    actorUserId: user.id,
    targetTable: "campaigns",
    targetId: id,
  })

  return NextResponse.json({ ok: true })
}
