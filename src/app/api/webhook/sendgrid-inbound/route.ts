import { NextResponse, type NextRequest } from "next/server"
import crypto from "node:crypto"
import { verifySendGridInboundToken } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { sendPushToStaff } from "@/server/push/send"
import { organizeConversation } from "@/server/ai/organizeInbound"
import { parseContactToken, parseEmailAddress } from "@/server/comms/emailAddress"
import { stripQuotedReply, parseEmailHeaders } from "@/server/comms/emailReply"
import { detectOptOutKeyword } from "@/server/comms/optOut"

/**
 * SendGrid Inbound Parse webhook. Configure the Inbound Parse host (the MX of
 * INBOUND_EMAIL_DOMAIN) to POST here:
 *   <APP_BASE_URL>/api/webhook/sendgrid-inbound?token=<SENDGRID_INBOUND_TOKEN>
 *
 * Trust model: Inbound Parse is unsigned, so the URL token is the auth. Contact
 * matching prefers the `reply+<contactId>@…` token we set as Reply-To on
 * outbound mail, falling back to the sender's email (auto-creating a contact,
 * exactly like inbound SMS). Insertion is idempotent on `provider_message_id`
 * (the Message-ID header). We always answer 200 on a parsed request so SendGrid
 * never retry-loops on a message we've already stored.
 */
export async function POST(request: NextRequest) {
  const verify = verifySendGridInboundToken(request.nextUrl.searchParams.get("token"))
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new NextResponse("Invalid form data", { status: 400 })
  }

  const str = (k: string): string | null => {
    const v = form.get(k)
    return typeof v === "string" ? v : null
  }

  const rawFrom = str("from")
  const rawTo = str("to")
  const subject = str("subject")?.slice(0, 200) ?? null
  const text = str("text")
  const html = str("html")
  const headersRaw = str("headers")
  const envelopeRaw = str("envelope")

  // Envelope is a JSON string: { "to": ["reply+<id>@…"], "from": "sender@…" }.
  let envelopeTo: string[] = []
  let envelopeFrom: string | null = null
  if (envelopeRaw) {
    try {
      const env = JSON.parse(envelopeRaw) as { to?: string[]; from?: string }
      envelopeTo = Array.isArray(env.to) ? env.to : []
      envelopeFrom = env.from ?? null
    } catch {
      /* ignore malformed envelope; fall back to the form fields */
    }
  }

  const senderEmail = parseEmailAddress(rawFrom) ?? parseEmailAddress(envelopeFrom)
  const headers = parseEmailHeaders(headersRaw)

  // Idempotency key: the Message-ID header. When absent, derive a stable hash
  // over the full parsed payload INCLUDING the raw headers blob (which carries
  // per-message Received/Date lines). Folding those in means two distinct emails
  // with identical short bodies (e.g. two "thanks") don't collide into one row,
  // while a byte-identical SendGrid retry still dedupes. Full digest, no slice.
  const providerMessageId =
    headers.messageId ??
    `gen_${crypto
      .createHash("sha256")
      .update(`${senderEmail ?? ""}|${subject ?? ""}|${text ?? ""}|${headersRaw ?? ""}`)
      .digest("hex")}`

  const admin = createSupabaseAdminClient()

  // Resolve the contact. Token first (rock-solid), then sender email. Only scan
  // genuine recipient fields (the `to` form field + the SMTP envelope `to`) —
  // NOT the raw headers blob, whose Cc/References/Subject lines are
  // sender-controlled and would let a forged header thread into any contact.
  const tokenContactId = parseContactToken([rawTo, ...envelopeTo])
  let contactId: string | null = null
  let created = false

  if (tokenContactId) {
    const { data } = await admin
      .from("contacts")
      .select("id")
      .eq("id", tokenContactId)
      .maybeSingle()
    if (data) contactId = data.id
  }

  if (!contactId && senderEmail) {
    const { data: upsertResult, error: upsertErr } = await admin.rpc(
      "upsert_contact_by_phone_or_email" as never,
      {
        p_name: null,
        p_phone: null,
        p_email: senderEmail,
        p_source: "email_inbound",
        p_consent_method: "email_reply",
        p_consent_at: new Date().toISOString(),
        p_tags: null,
        p_language: "en",
      } as never,
    )
    if (upsertErr) {
      await logAudit({
        action: "webhook.sendgrid.inbound",
        diff: { reason: "upsert_failed", error: upsertErr.message, message_id: providerMessageId },
      })
      return new NextResponse("", { status: 200 })
    }
    const upsert = upsertResult as { contact_id: string; created: boolean } | null
    contactId = upsert?.contact_id ?? null
    created = upsert?.created ?? false
  }

  if (!contactId) {
    // No token and no usable sender — nothing to thread to. Record + 200.
    await logAudit({
      action: "webhook.sendgrid.inbound",
      diff: { reason: "no_contact", raw_from: rawFrom, message_id: providerMessageId },
    })
    return new NextResponse("", { status: 200 })
  }

  const body = stripQuotedReply(text)

  // Opt-out wall: a transactional 1:1 email carries no carrier/List-Unsubscribe
  // backstop, so a plain-language "STOP"/"unsubscribe" reply must be honored
  // here (the AI soft opt-out in organizeConversation is best-effort and off
  // when AI is disabled). Mirrors the SMS inbound STOP/START handling, but
  // toggles the EMAIL flag.
  const keyword = detectOptOutKeyword(body)
  const nowIso = new Date().toISOString()
  if (keyword === "stop") {
    await admin
      .from("contacts")
      .update({ email_unsubscribed_at: nowIso })
      .eq("id", contactId)
      .is("email_unsubscribed_at", null)
    await logAudit({
      action: "contact.unsubscribe_email",
      targetTable: "contacts",
      targetId: contactId,
      diff: { source: "inbound_email_stop", message_id: providerMessageId },
    })
  } else if (keyword === "start") {
    await admin
      .from("contacts")
      .update({ email_unsubscribed_at: null })
      .eq("id", contactId)
    await logAudit({
      action: "contact.update",
      targetTable: "contacts",
      targetId: contactId,
      diff: { source: "inbound_email_start", message_id: providerMessageId },
    })
  }

  const { data: inserted, error: msgErr } = await admin
    .from("messages")
    .insert({
      contact_id: contactId,
      direction: "in",
      body,
      body_html: html,
      subject,
      channel: "email",
      provider_message_id: providerMessageId,
      status: "received",
      email_meta: {
        from: senderEmail,
        to: rawTo?.slice(0, 320) ?? null,
        message_id: headers.messageId,
        in_reply_to: headers.inReplyTo,
        references: headers.references,
        token_matched: Boolean(tokenContactId),
      },
    })
    .select("id")
    .maybeSingle()

  // 23xxx = unique_violation (a SendGrid retry of a message we already stored) —
  // treat as success. Any OTHER error is a genuine transient/DB failure: return
  // 500 so SendGrid retries (the provider_message_id UNIQUE index makes the
  // retry idempotent), rather than 200 which would silently drop the email.
  if (msgErr && !(msgErr as { code?: string }).code?.toString().startsWith("23")) {
    await logAudit({
      action: "webhook.sendgrid.inbound",
      diff: { reason: "insert_failed", error: msgErr.message, message_id: providerMessageId },
    })
    return new NextResponse("DB insert failed", { status: 500 })
  }

  await logAudit({
    action: "webhook.sendgrid.inbound",
    targetTable: "messages",
    targetId: inserted?.id ?? providerMessageId,
    diff: { contact_id: contactId, from: senderEmail, token_matched: Boolean(tokenContactId) },
  })

  // Best-effort follow-ups, only for a genuinely new inbound (not a retry).
  if (inserted?.id) {
    const { data: c } = await admin
      .from("contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle()

    try {
      const title = c?.name || senderEmail || "New email"
      const preview = subject ? `${subject}: ${body}` : body || "New email"
      await sendPushToStaff({
        title,
        body: preview.slice(0, 140),
        url: `/inbox?c=${contactId}`,
        tag: `contact-${contactId}`,
      })
    } catch {
      /* delivery is best-effort */
    }

    // Sort the conversation into a segment / advance status / tag. Skip for a
    // brand-new contact's first email is fine to run; it is non-destructive.
    void created
    await organizeConversation(contactId, {
      source: "email_inbound",
      messageSid: providerMessageId,
      channel: "email",
    })
  }

  return new NextResponse("", { status: 200 })
}
