import { NextResponse, type NextRequest } from "next/server"
import { verifyTwilioRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { detectOptOutKeyword, detectMarketingJoin } from "@/server/comms/optOut"
import { toE164 } from "@/server/validation/phone"
import { sendPushToStaff } from "@/server/push/send"
import { formatPhone } from "@/lib/utils"

/**
 * Twilio inbound message webhook. Configure this URL in the Twilio
 * Messaging Service:
 *   https://<host>/api/webhook/twilio-inbound
 *
 * Trust model: signature verified against APP_BASE_URL + pathname (NEVER
 * the request's `Host` header, which the proxy may rewrite). Message
 * insertion is idempotent on `twilio_sid` UNIQUE. Contact upsert uses an
 * atomic Postgres RPC to defeat concurrent-create races.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v

  const verify = verifyTwilioRequest(request, request.nextUrl.pathname, params)
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  const from = params.From
  const to = params.To
  const body = params.Body ?? ""
  const messageSid = params.MessageSid
  const numMedia = parseInt(params.NumMedia ?? "0", 10)
  const mediaUrl = numMedia > 0 ? params.MediaUrl0 ?? null : null
  const channel = numMedia > 0 ? "mms" : "sms"

  if (!from || !messageSid) {
    return new NextResponse("Missing required params", { status: 400 })
  }

  // Reject only by audit-log + 200 — never 500. Twilio retries 5xx and we'd
  // loop forever on an unparseable sender.
  const phone = toE164(from)
  if (!phone) {
    await logAudit({
      action: "webhook.twilio.inbound",
      diff: { reason: "unparseable_from", raw_from: from, message_sid: messageSid },
    })
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`,
      { status: 200, headers: { "Content-Type": "application/xml" } },
    )
  }

  const admin = createSupabaseAdminClient()

  // Atomic upsert: collapses the "select then insert" race with concurrent
  // form submissions and other inbound messages. Refuses to overwrite when
  // phone-match and email-match resolve to different contacts.
  const { data: upsertResult, error: upsertErr } = await admin.rpc(
    "upsert_contact_by_phone_or_email" as never,
    {
      p_name: null,
      p_phone: phone,
      p_email: null,
      p_source: "sms_inbound",
      p_consent_method: "two_way_reply",
      p_consent_at: new Date().toISOString(),
      p_tags: null,
      p_language: "en",
    } as never,
  )

  if (upsertErr) {
    await logAudit({
      action: "webhook.twilio.inbound",
      diff: { reason: "upsert_failed", error: upsertErr.message, message_sid: messageSid },
    })
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`,
      { status: 200, headers: { "Content-Type": "application/xml" } },
    )
  }

  const contactId = (upsertResult as { contact_id: string } | null)?.contact_id
  if (!contactId) {
    return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    })
  }

  const keyword = detectOptOutKeyword(body)
  const nowIso = new Date().toISOString()

  if (keyword === "stop") {
    await admin
      .from("contacts")
      .update({ sms_opted_out_at: nowIso })
      .eq("id", contactId)
      .is("sms_opted_out_at", null)
    await logAudit({
      action: "contact.opt_out_sms",
      targetTable: "contacts",
      targetId: contactId,
      diff: { source: "inbound_stop", message_sid: messageSid },
    })
  } else if (keyword === "start") {
    // A reply of START re-establishes consent. TCPA: record a fresh
    // consent timestamp + method so the audit shows continuous proof.
    await admin
      .from("contacts")
      .update({
        sms_opted_out_at: null,
        consent_method: "two_way_start",
        consent_at: nowIso,
      })
      .eq("id", contactId)
    await logAudit({
      action: "contact.opt_in_sms",
      targetTable: "contacts",
      targetId: contactId,
      diff: { source: "inbound_start", message_sid: messageSid, consent_at: nowIso },
    })
  } else if (detectMarketingJoin(body)) {
    // Reply JOIN/SUBSCRIBE = express opt-in to recurring/marketing messages.
    // Distinct from START (which only lifts a STOP). Clears any prior decline.
    await admin
      .from("contacts")
      .update({
        marketing_consent_at: nowIso,
        marketing_consent_method: "reply_join",
        marketing_opted_out_at: null,
      })
      .eq("id", contactId)
    await logAudit({
      action: "contact.opt_in_sms",
      targetTable: "contacts",
      targetId: contactId,
      diff: { source: "inbound_join", basis: "marketing", message_sid: messageSid, consent_at: nowIso },
    })
  }

  // Idempotent message insert.
  const { data: inserted, error: msgErr } = await admin
    .from("messages")
    .insert({
      contact_id: contactId,
      direction: "in",
      body,
      media_url: mediaUrl,
      channel,
      twilio_sid: messageSid,
      status: "received",
    })
    .select("id")
    .maybeSingle()

  // 23505 is the Postgres unique_violation code. Anything else is a real
  // failure and worth bubbling to Twilio so it retries.
  if (msgErr && !(msgErr as { code?: string }).code?.toString().startsWith("23")) {
    return new NextResponse("DB insert failed", { status: 500 })
  }

  await logAudit({
    action: "webhook.twilio.inbound",
    targetTable: "messages",
    targetId: inserted?.id ?? messageSid,
    diff: { contact_id: contactId, from: phone, to, keyword },
  })

  // Push-notify staff of a genuinely new inbound message (not a Twilio retry
  // of one we already stored). Best-effort: never fail the webhook on push.
  if (inserted?.id) {
    try {
      const { data: c } = await admin
        .from("contacts")
        .select("name")
        .eq("id", contactId)
        .maybeSingle()
      const title = c?.name || formatPhone(phone) || "New message"
      const preview = body.trim() || (mediaUrl ? "Sent a photo" : "New message")
      await sendPushToStaff({
        title,
        body: preview.slice(0, 140),
        url: `/inbox?c=${contactId}`,
        tag: `contact-${contactId}`,
      })
    } catch {
      /* swallow — delivery is best-effort */
    }
  }

  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`, {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  })
}
