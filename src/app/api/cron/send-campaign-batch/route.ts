import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { processCampaignBatch } from "@/server/comms/campaignWorker"
import { backfillMessagePrices } from "@/server/billing/twilio"

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

  return NextResponse.json({ ok: true, campaigns: summary, priced, ran_at: nowIso })
}
