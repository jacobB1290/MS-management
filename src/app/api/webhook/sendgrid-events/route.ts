import { NextResponse, type NextRequest } from "next/server"
import { verifySendGridRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"

/**
 * SendGrid Event Webhook. Idempotent on sendgrid_event_id via UPSERT
 * ON CONFLICT DO NOTHING. The trigger `email_events_sync_unsubscribe`
 * mirrors unsubscribe + spamreport + dropped back to contacts.
 *
 * Configure in the SendGrid dashboard:
 *   https://<host>/api/webhook/sendgrid-events
 * Then copy the Signed Webhook public key into SENDGRID_WEBHOOK_PUBLIC_KEY.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const verify = verifySendGridRequest(request, rawBody)
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  type SgEvent = {
    sg_event_id?: string
    event?: string
    email?: string
    timestamp?: number
    [k: string]: unknown
  }

  let events: SgEvent[]
  try {
    events = JSON.parse(rawBody) as SgEvent[]
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }
  if (!Array.isArray(events)) {
    return new NextResponse("Expected array of events", { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const rows = events
    .filter((e) => e.event && e.sg_event_id)
    .map((e) => ({
      sendgrid_event_id: e.sg_event_id ?? null,
      event_type: e.event ?? "unknown",
      // Normalize to lowercase so case-mixed SendGrid payloads match contacts.email (citext).
      email: e.email?.toLowerCase() ?? null,
      payload: e as never,
      occurred_at: e.timestamp
        ? new Date(e.timestamp * 1000).toISOString()
        : new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await admin
      .from("email_events")
      .upsert(rows, { onConflict: "sendgrid_event_id", ignoreDuplicates: true })
    if (error) return new NextResponse(`DB error: ${error.message}`, { status: 500 })
  }

  await logAudit({
    action: "webhook.sendgrid.event",
    diff: { count: rows.length, events_seen: rows.map((r) => r.event_type) },
  })

  return new NextResponse("", { status: 200 })
}
