import "server-only"
import { assertCanSendEmail } from "./optOut"
import { logAudit } from "@/server/audit"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { brevoConfigured, brevoReplyTo, sendTransactionalEmail } from "./brevo"
import {
  sanitizeEmailContent,
  wrapPersonalEmail,
  toSmartQuotes,
  personalSignatureText,
  plainTextToContentHtml,
} from "./emailHtml"
import {
  resolveEmailAttachments,
  type BrevoAttachment,
  type StoredAttachmentMeta,
} from "@/server/media/emailAttachments"
import type { EmailAttachment } from "@/lib/email-attachments"
import type { Json } from "@/lib/database.types"

/**
 * Build the personalized parts of a 1:1 email from an operator's draft: the
 * smart-quoted plain body, the text/plain part with a warm human sign-off, and
 * the wrapped HTML document. The HTML is ALWAYS produced — a plain typed reply
 * sends the same stylized personal email (letterhead + sign-off) as an
 * AI-beautified one, with text/plain as the fallback. `wrappedHtml` (what sends)
 * and `previewHtml` (what staff preview) are identical, so the preview is
 * faithful to what actually sends.
 */
export async function composePersonalEmail(args: {
  contactId: string
  body: string
  html?: string | null
  sentByUserId?: string | null
}): Promise<{
  cleanBody: string
  outgoingText: string
  wrappedHtml: string
  previewHtml: string
  senderName: string | null
}> {
  const admin = createSupabaseAdminClient()
  const [senderName, contactLang] = await Promise.all([
    lookupSenderName(admin, args.sentByUserId),
    lookupContactLanguage(admin, args.contactId),
  ])

  const cleanBody = toSmartQuotes(args.body)
  const outgoingText = `${cleanBody}\n\n${personalSignatureText(senderName, contactLang)}`

  // Defense in depth: the AI endpoint already sanitized; sanitize again before
  // it ever reaches an inbox.
  const sanitizedFragment = args.html ? sanitizeEmailContent(args.html) : null
  // A plain typed reply is rendered as paragraphs and sent as the SAME stylized
  // personal email as an AI-beautified one — the warm personal shell (letterhead
  // + sign-off), NOT a bulk marketing template. The text/plain part rides along
  // as the fallback. Preview and send share this HTML.
  const contentFragment = sanitizedFragment ?? plainTextToContentHtml(cleanBody)
  const wrappedHtml = wrapPersonalEmail({
    contentHtml: contentFragment,
    senderName,
    lang: contactLang,
  })

  return { cleanBody, outgoingText, wrappedHtml, previewHtml: wrappedHtml, senderName }
}

/**
 * Canonical 1:1 conversational email send. Mirrors `sendSms`: enforces opt-out
 * at the function level, logs the outbound row into the SAME `messages` thread
 * (channel 'email'), then sends via Brevo's TRANSACTIONAL API — or records a
 * mock when BREVO_API_KEY is absent. This is a relationship message, not bulk
 * marketing, so it carries no List-Unsubscribe header (which would brand it as a
 * mailing list and hurt the relationship); opt-out is still enforced by
 * `assertCanSendEmail`. The Reply-To is the church's Google Workspace mailbox,
 * so the recipient's reply lands in Gmail where a human answers it.
 */
export async function sendDirectEmail(args: {
  contactId: string
  subject: string
  body: string
  sentByUserId?: string | null
  /** Optional beautified content HTML fragment (no <html>/<body>). When given,
   *  it is sanitized + wrapped in the personal email shell and sent as the HTML
   *  part alongside the plain-text `body`. */
  html?: string | null
  /** Optional file attachments, already uploaded to the private bucket. */
  attachments?: EmailAttachment[]
}): Promise<SendDirectEmailResult> {
  const check = await assertCanSendEmail(args.contactId)
  if (!check.ok) return { ok: false, reason: check.reason }

  const admin = createSupabaseAdminClient()

  // Personalize (sign-off, language, smart quotes, HTML shell). Shared with the
  // preview endpoint so what staff preview is exactly what sends.
  const { cleanBody, outgoingText, wrappedHtml } = await composePersonalEmail({
    contactId: args.contactId,
    body: args.body,
    html: args.html,
    sentByUserId: args.sentByUserId,
  })

  // Resolve + validate attachments (download from the private bucket, base64).
  const resolved = await resolveEmailAttachments(args.attachments ?? [])
  if (!resolved.ok) {
    return { ok: false, reason: "attachment_failed", detail: resolved.reason }
  }

  const replyTo = brevoReplyTo()
  const emailMeta = buildEmailMeta(replyTo, resolved.meta)
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      contact_id: args.contactId,
      direction: "out",
      body: cleanBody,
      body_html: wrappedHtml,
      subject: args.subject,
      channel: "email",
      status: "queued",
      context: "conversational_reply",
      sent_by: args.sentByUserId ?? null,
      email_meta: emailMeta,
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return { ok: false, reason: "db_insert_failed", detail: insertErr?.message }
  }

  const provider = await sendTransactionalOrMock({
    to: check.email,
    subject: args.subject,
    text: outgoingText,
    html: wrappedHtml,
    replyTo,
    attachments: resolved.brevo,
    idempotencyKey: inserted.id,
  })

  await admin
    .from("messages")
    .update({
      provider_message_id: provider.id,
      status: provider.error ? "failed" : provider.mock ? "mocked" : "sent",
      error: provider.error,
    })
    .eq("id", inserted.id)

  await logAudit({
    action: provider.error ? "message.send_failed" : "message.send",
    actorUserId: args.sentByUserId ?? null,
    targetTable: "messages",
    targetId: inserted.id,
    diff: {
      channel: "email",
      contact_id: args.contactId,
      provider_id: provider.id,
      mock: provider.mock,
    },
  })

  if (provider.error) {
    return { ok: false, reason: "provider_failed", detail: provider.error }
  }
  return { ok: true, messageId: inserted.id, providerId: provider.id, mock: provider.mock }
}

export type SendDirectEmailResult =
  | { ok: true; messageId: string; providerId: string | null; mock: boolean }
  | {
      ok: false
      reason:
        | "not_found"
        | "no_channel"
        | "unsubscribed"
        | "db_insert_failed"
        | "provider_failed"
        | "attachment_failed"
      detail?: string
    }

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

/** The sending staff member's display name, for the email sign-off. */
async function lookupSenderName(
  admin: AdminClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { data } = await admin
    .from("app_users")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle()
  return data?.display_name?.trim() || null
}

/** The contact's language (en/ru) for the email's `lang` attribute. */
async function lookupContactLanguage(
  admin: AdminClient,
  contactId: string,
): Promise<string> {
  const { data } = await admin
    .from("contacts")
    .select("language")
    .eq("id", contactId)
    .maybeSingle()
  return data?.language === "ru" ? "ru" : "en"
}

/** Assemble the `email_meta` JSON for the message row: reply_to + attachments. */
function buildEmailMeta(
  replyTo: string | null,
  attachments: StoredAttachmentMeta[],
): Json | null {
  const meta: Record<string, Json> = {}
  if (replyTo) meta.reply_to = replyTo
  if (attachments.length > 0) {
    meta.attachments = attachments.map((a) => ({
      filename: a.filename,
      type: a.type,
      size: a.size,
      path: a.path,
    }))
  }
  return Object.keys(meta).length > 0 ? meta : null
}

interface ProviderResult {
  id: string | null
  error: string | null
  mock: boolean
}

/** Send via Brevo transactional, or return a mock id when Brevo isn't configured. */
async function sendTransactionalOrMock(args: {
  to: string
  subject: string
  text: string
  html: string | null
  replyTo: string
  attachments: BrevoAttachment[]
  idempotencyKey: string
}): Promise<ProviderResult> {
  if (!brevoConfigured()) {
    return { id: `MOCK_${crypto.randomUUID()}`, error: null, mock: true }
  }

  const res = await sendTransactionalEmail({
    to: [{ email: args.to }],
    subject: args.subject,
    htmlContent: args.html ?? undefined,
    textContent: args.text,
    replyTo: { email: args.replyTo },
    ...(args.attachments.length > 0 ? { attachment: args.attachments } : {}),
    // Safe-retry guard: a re-send of the same message row dedupes at Brevo.
    headers: { "Idempotency-Key": args.idempotencyKey },
  })

  if (!res.ok) return { id: null, error: res.error, mock: false }
  return { id: res.data.messageId ?? null, error: null, mock: false }
}
