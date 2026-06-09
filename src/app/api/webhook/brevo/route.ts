import { NextResponse, type NextRequest } from "next/server"
import { verifyBrevoWebhookToken } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"

/**
 * Brevo marketing webhook. Brevo does NOT sign webhooks, so the URL `?token=`
 * is the auth (see verifyBrevoWebhookToken). Configure in Brevo with:
 *   <APP_BASE_URL>/api/webhook/brevo?token=<BREVO_WEBHOOK_TOKEN>
 * subscribing at least: unsubscribed, hardBounce, spam.
 *
 * Brevo emits NO per-event UUID, so we synthesize a dedup key
 * (message-id|email|event|camp_id|ts) and upsert into email_events with
 * ON CONFLICT DO NOTHING. The DB trigger email_events_sync_unsubscribe mirrors
 * 'unsubscribe' / 'spam' / 'hard_bounce' back to contacts.email_unsubscribed_at.
 *
 * Case trap: webhooks are REGISTERED with camelCase event names (hardBounce,
 * unsubscribed) but the PAYLOAD reports snake_case (hard_bounce, unsubscribe).
 * We store and trigger on the payload's snake_case form.
 */
type BrevoEvent = {
  event?: string
  email?: string
  camp_id?: number
  ts_event?: number
  ts?: number
  "message-id"?: string
  [k: string]: unknown
}

export async function POST(request: NextRequest) {
  const verify = verifyBrevoWebhookToken(request.nextUrl.searchParams.get("token"))
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  const rawBody = await request.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const rows = extractEvents(parsed)
    .filter((e) => e.event && e.email)
    .map((e) => {
      const occurredMs = e.ts_event ? e.ts_event * 1000 : e.ts ? e.ts * 1000 : Date.now()
      const messageId = typeof e["message-id"] === "string" ? e["message-id"] : ""
      // Synthesized idempotency key — Brevo gives no per-event id.
      const providerEventId = [
        messageId,
        e.email ?? "",
        e.event ?? "",
        e.camp_id ?? "",
        e.ts_event ?? e.ts ?? "",
      ].join("|")
      return {
        provider_event_id: providerEventId,
        event_type: e.event ?? "unknown",
        // Normalize to lowercase so case-mixed payloads match contacts.email (citext).
        email: e.email?.toLowerCase() ?? null,
        payload: e as never,
        occurred_at: new Date(occurredMs).toISOString(),
      }
    })

  if (rows.length > 0) {
    const { error } = await admin
      .from("email_events")
      .upsert(rows, { onConflict: "provider_event_id", ignoreDuplicates: true })
    if (error) return new NextResponse(`DB error: ${error.message}`, { status: 500 })
  }

  await logAudit({
    action: "webhook.brevo.event",
    diff: { count: rows.length, events_seen: rows.map((r) => r.event_type) },
  })

  return new NextResponse("", { status: 200 })
}

/** Brevo posts one event per request by default, but tolerate batched shapes. */
function extractEvents(parsed: unknown): BrevoEvent[] {
  if (Array.isArray(parsed)) return parsed as BrevoEvent[]
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.events)) return obj.events as BrevoEvent[]
    if (Array.isArray(obj.items)) return obj.items as BrevoEvent[]
    return [parsed as BrevoEvent]
  }
  return []
}
