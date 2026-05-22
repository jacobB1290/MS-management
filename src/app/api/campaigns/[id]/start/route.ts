import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { processCampaignBatch } from "@/server/comms/campaignWorker"
import type { Json } from "@/lib/database.types"

/**
 * Start a campaign. Builds the recipient list from audience_filter (honoring
 * opt-outs at row creation time so we have a permanent record of who was
 * skipped and why), flips status to 'sending', then kicks off the first
 * batch synchronously. Subsequent batches are picked up by the cron worker
 * at /api/cron/send-campaign-batch.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const admin = createSupabaseAdminClient()
  const { data: campaign, error } = await admin
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json({ error: "invalid_status", status: campaign.status }, { status: 400 })
  }

  // Build the audience. v1 supports two filter shapes:
  //   { all: true }              → every contact
  //   { tags: ["a","b"] }        → contacts whose tags contain any of these
  const filter = (campaign.audience_filter ?? {}) as Record<string, unknown>
  let audienceQuery = admin
    .from("contacts")
    .select("id, phone, email, sms_opted_out_at, email_unsubscribed_at")

  if (Array.isArray(filter.tags) && filter.tags.length > 0) {
    audienceQuery = audienceQuery.overlaps("tags", filter.tags as string[])
  } else if (filter.all !== true) {
    return NextResponse.json(
      { error: "no_audience_filter", detail: "Provide {all:true} or {tags:[...]}." },
      { status: 400 },
    )
  }

  const { data: audience, error: audienceErr } = await audienceQuery
  if (audienceErr) {
    return NextResponse.json({ error: audienceErr.message }, { status: 500 })
  }

  // Stage recipients with up-front opt-out / no-channel detection.
  const rows = (audience ?? []).map((c) => {
    if (campaign.channel === "sms") {
      if (!c.phone) return { contact_id: c.id, status: "skipped_no_channel" as const }
      if (c.sms_opted_out_at) return { contact_id: c.id, status: "skipped_opt_out" as const }
    } else {
      if (!c.email) return { contact_id: c.id, status: "skipped_no_channel" as const }
      if (c.email_unsubscribed_at) return { contact_id: c.id, status: "skipped_unsubscribed" as const }
    }
    return { contact_id: c.id, status: "queued" as const }
  }).map((r) => ({ campaign_id: id, ...r }))

  if (rows.length > 0) {
    const { error: insertErr } = await admin
      .from("campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
  }

  await admin
    .from("campaigns")
    .update({
      status: "sending",
      started_at: new Date().toISOString(),
    })
    .eq("id", id)

  const stats = {
    total: rows.length,
    queued: rows.filter((r) => r.status === "queued").length,
    skipped_opt_out: rows.filter((r) => r.status === "skipped_opt_out").length,
    skipped_unsubscribed: rows.filter((r) => r.status === "skipped_unsubscribed").length,
    skipped_no_channel: rows.filter((r) => r.status === "skipped_no_channel").length,
  }

  await logAudit({
    action: "campaign.start",
    actorUserId: user.id,
    targetTable: "campaigns",
    targetId: id,
    diff: stats as Json,
  })

  // Send the first batch immediately; cron picks up the rest.
  await processCampaignBatch(id, 25)

  return NextResponse.json({ ok: true, ...stats })
}
