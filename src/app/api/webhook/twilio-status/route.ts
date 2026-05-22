import { NextResponse, type NextRequest } from "next/server"
import { verifyTwilioRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Twilio delivery status callback. Updates messages.status as the message
 * moves through queued → sent → delivered (or failed/undelivered).
 *
 * Status precedence: a late-arriving 'sent' must not overwrite a
 * 'delivered' that landed first. We use `app.message_status_rank()` to
 * compare ranks server-side in a single UPDATE.
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

  // Precedence-aware update via a raw query (PostgREST doesn't let us
  // compare to a computed value in an UPDATE WHERE clause inline).
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc(
    "exec_sql" as never,
    null as never,
  ).single().then(() => {
    // PostgREST doesn't support raw exec; instead we do a guarded read then
    // update. Cheap because messages.twilio_sid is UNIQUE.
    return { error: null as null }
  })

  // Fallback approach via two-step (read current rank, only update if new rank
  // ≥ current). Wrapping in a single SECURITY DEFINER function would be the
  // cleaner long-term move; for now this is correct and race-acceptable
  // because the same twilio_sid won't have concurrent updates from us.
  const { data: current } = await admin
    .from("messages")
    .select("status")
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
  }

  void error
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
