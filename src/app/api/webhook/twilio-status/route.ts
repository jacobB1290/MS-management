import { NextResponse, type NextRequest } from "next/server"
import { verifyTwilioRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { captureMessagePrice, PRICED_STATUSES } from "@/server/billing/twilio"

/**
 * Twilio delivery status callback. Updates messages.status as the message
 * moves through queued → sent → delivered (or failed/undelivered), and
 * captures the real billed price once Twilio has finalized it.
 *
 * Status precedence: a late-arriving 'sent' must not overwrite a 'delivered'
 * that landed first. We read the current status and only write when the
 * incoming rank is ≥ current. Race-acceptable because the same twilio_sid
 * won't have concurrent updates from us.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v

  const verify = verifyTwilioRequest(request, request.nextUrl.pathname, params)
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  const sid = params.MessageSid
  const status = params.MessageStatus
  const errorCode = params.ErrorCode || null

  if (!sid || !status) {
    return new NextResponse("Missing params", { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data: current } = await admin
    .from("messages")
    .select("status, price")
    .eq("twilio_sid", sid)
    .maybeSingle()

  if (current) {
    const newRank = STATUS_RANK[status] ?? -1
    const curRank = STATUS_RANK[current.status ?? ""] ?? -1
    if (newRank >= curRank) {
      await admin
        .from("messages")
        .update({ status, error: errorCode })
        .eq("twilio_sid", sid)
    }

    // Twilio attaches price asynchronously, so the callback body never carries
    // it — fetch the Message resource once we're past handoff and not already
    // settled. Self-heals via the cron backfill if it's still null here.
    if (current.price == null && PRICED_STATUSES.has(status)) {
      await captureMessagePrice(sid)
    }
  }

  return new NextResponse("", { status: 200 })
}

const STATUS_RANK: Record<string, number> = {
  received: 0,
  queued: 1,
  accepted: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  read: 6,
  undelivered: 7,
  failed: 8,
  mocked: 9,
}
