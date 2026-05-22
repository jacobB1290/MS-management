import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { sendSms } from "./sendSms"
import { sendEmail } from "./sendEmail"
import type { SendSmsResult } from "./sendSms"
import type { SendEmailResult } from "./sendEmail"

/**
 * Process up to `batchSize` queued recipients for the given campaign.
 * Atomically claims work via the SECURITY DEFINER RPC `app.claim_campaign_batch`
 * (SELECT FOR UPDATE SKIP LOCKED) so concurrent cron workers can't double-send.
 */
export async function processCampaignBatch(
  campaignId: string,
  batchSize = 25,
): Promise<{ processed: number; campaignDone: boolean }> {
  const admin = createSupabaseAdminClient()

  const { data: campaign, error: cErr } = await admin
    .from("campaigns")
    .select("id, channel, body, sendgrid_template_id, email_subject, status")
    .eq("id", campaignId)
    .maybeSingle()
  if (cErr || !campaign) return { processed: 0, campaignDone: false }
  if (campaign.status === "cancelled" || campaign.status === "done") {
    return { processed: 0, campaignDone: true }
  }

  // Atomic claim — no race window with concurrent workers.
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
    const sendResult: SendSmsResult | SendEmailResult =
      campaign.channel === "sms"
        ? await sendSms({
            contactId: row.contact_id,
            body: campaign.body ?? "",
            campaignId,
          })
        : await sendEmail({
            contactId: row.contact_id,
            templateId: campaign.sendgrid_template_id ?? "",
            subject: campaign.email_subject ?? "",
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
  result: SendSmsResult | SendEmailResult,
) {
  if (result.ok) {
    const providerId =
      "providerSid" in result ? result.providerSid : result.providerId
    await admin
      .from("campaign_recipients")
      .update({
        status: "sent",
        provider_id: providerId,
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
  | "skipped_no_channel" {
  switch (reason) {
    case "opt_out":
      return "skipped_opt_out"
    case "unsubscribed":
      return "skipped_unsubscribed"
    case "no_channel":
      return "skipped_no_channel"
    default:
      return "failed"
  }
}
