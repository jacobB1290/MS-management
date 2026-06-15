import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { processCampaignBatch } from "@/server/comms/campaignWorker"
import { refreshBrevoCampaignStats } from "@/server/comms/brevoCampaign"
import { syncGmailMailbox } from "@/server/email/gmailSync"
import { backfillMessagePrices } from "@/server/billing/twilio"

// Email blasts can take a few seconds to hand off to Brevo (list import + send).
export const maxDuration = 60

/**
 * Vercel Cron / external scheduler hits this every minute. Picks up any
 * 'sending' campaign (and 'scheduled' campaigns whose time has come) and
 * advances each by one batch.
 *
 * Auth: Bearer token via `CRON_SECRET` env. Vercel Cron sends it automatically
 * if set in the project settings; external schedulers must send the same.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  // Fail closed: an environment without CRON_SECRET set must NOT allow
  // unauthenticated cron triggers (anyone could drain Twilio credits).
  if (!expected) {
    return new NextResponse("Cron not configured", { status: 503 })
  }
  if (provided !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const admin = createSupabaseAdminClient()

  // Promote scheduled → sending where time has come.
  const nowIso = new Date().toISOString()
  await admin
    .from("campaigns")
    .update({ status: "sending", started_at: nowIso })
    .lte("scheduled_at", nowIso)
    .eq("status", "scheduled")

  const { data: active } = await admin
    .from("campaigns")
    .select("id")
    .eq("status", "sending")
    .limit(20)

  const summary: Array<{ id: string; processed: number; done: boolean }> = []
  for (const c of active ?? []) {
    const { processed, campaignDone } = await processCampaignBatch(c.id, 50)
    summary.push({ id: c.id, processed, done: campaignDone })
  }

  // Settle prices Twilio finalized after the status callback fired (or that we
  // missed). Bounded and idempotent — no-ops once everything is priced.
  const priced = await backfillMessagePrices(50)

  // Refresh Brevo engagement stats for email blasts sent in the last week, so the
  // campaign detail page shows live opens/clicks/unsubscribes without a per-load
  // API call. Bounded; no-ops in mock mode.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentEmail } = await admin
    .from("campaigns")
    .select("id")
    .eq("channel", "email")
    .not("brevo_campaign_id", "is", null)
    .gte("completed_at", weekAgo)
    .limit(10)
  for (const c of recentEmail ?? []) {
    await refreshBrevoCampaignStats(c.id)
  }

  // Mirror new mail from the support@ Gmail mailbox into the CRM threads.
  // No-op until the Gmail OAuth token is configured.
  const gmail = await syncGmailMailbox()

  return NextResponse.json({ ok: true, campaigns: summary, priced, gmail, ran_at: nowIso })
}
