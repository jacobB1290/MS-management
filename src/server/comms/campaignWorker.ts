import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { sendSms } from "./sendSms"
import { advanceBrevoEmailCampaign } from "./brevoCampaign"
import type { SendSmsResult } from "./sendSms"

/**
 * Advance a campaign by one unit of work. The two channels work differently:
 *
 *   - SMS: per-recipient send. Atomically claims a batch via the SECURITY
 *     DEFINER RPC `claim_campaign_batch` (SELECT FOR UPDATE SKIP LOCKED) so
 *     concurrent cron workers can't double-send, then sends each via Twilio.
 *   - Email: bulk blast via Brevo's marketing lane. We don't loop per recipient;
 *     `advanceBrevoEmailCampaign` hands a list to Brevo and is idempotent, so
 *     calling it once finishes a small send and a repeat tick resumes a large
 *     one still syncing.
 */
export async function processCampaignBatch(
  campaignId: string,
  batchSize = 25,
): Promise<{ processed: number; campaignDone: boolean }> {
  const admin = createSupabaseAdminClient()

  const { data: campaign, error: cErr } = await admin
    .from("campaigns")
    .select("id, channel, body, media_url, status")
    .eq("id", campaignId)
    .maybeSingle()
  if (cErr || !campaign) return { processed: 0, campaignDone: false }
  if (campaign.status === "cancelled" || campaign.status === "done") {
    return { processed: 0, campaignDone: true }
  }

  if (campaign.channel === "email") {
    const res = await advanceBrevoEmailCampaign(campaignId)
    // Done unless the bulk import is still syncing (the only resumable state).
    const campaignDone = res.ok ? res.phase !== "syncing" : true
    const processed = res.ok && res.phase === "sent" ? res.count : 0
    return { processed, campaignDone }
  }

  // ---- SMS: atomic per-recipient batch -------------------------------------
  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_campaign_batch" as never,
    { p_campaign_id: campaignId, p_batch_size: batchSize } as never,
  )
  if (claimErr) {
    console.error("[campaignWorker] claim failed:", claimErr.message)
    return { processed: 0, campaignDone: false }
  }
  const rows = (claimed as { contact_id: string }[] | null) ?? []

  if (rows.length === 0) {
    // No more queued work — finalize if nothing else is in flight.
    const { count: remaining } = await admin
      .from("campaign_recipients")
      .select("contact_id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["queued", "sending"])

    if ((remaining ?? 0) === 0 && campaign.status === "sending") {
      await admin
        .from("campaigns")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", campaignId)
      return { processed: 0, campaignDone: true }
    }
    return { processed: 0, campaignDone: false }
  }

  let processed = 0
  for (const row of rows) {
    const sendResult = await sendSms({
      contactId: row.contact_id,
      body: campaign.body ?? "",
      mediaUrl: campaign.media_url,
      campaignId,
    })
    await recordRecipientOutcome(admin, campaignId, row.contact_id, sendResult)
    processed += 1
  }

  return { processed, campaignDone: false }
}

async function recordRecipientOutcome(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  campaignId: string,
  contactId: string,
  result: SendSmsResult,
) {
  if (result.ok) {
    await admin
      .from("campaign_recipients")
      .update({
        status: "sent",
        provider_id: result.providerSid,
        error: null,
        sent_at: new Date().toISOString(),
      })
      .eq("campaign_id", campaignId)
      .eq("contact_id", contactId)
    return
  }

  const status = recipientStatusFromReason(result.reason)
  await admin
    .from("campaign_recipients")
    .update({
      status,
      provider_id: null,
      error: "detail" in result ? result.detail ?? null : null,
      sent_at: new Date().toISOString(),
    })
    .eq("campaign_id", campaignId)
    .eq("contact_id", contactId)
}

function recipientStatusFromReason(
  reason: string,
):
  | "failed"
  | "skipped_opt_out"
  | "skipped_unsubscribed"
  | "skipped_no_channel"
  | "skipped_no_consent" {
  switch (reason) {
    case "opt_out":
    case "marketing_opted_out":
      return "skipped_opt_out"
    case "unsubscribed":
      return "skipped_unsubscribed"
    case "no_channel":
      return "skipped_no_channel"
    case "no_marketing_consent":
      return "skipped_no_consent"
    default:
      return "failed"
  }
}
