import "server-only"
import { assertCanSendEmail } from "./optOut"
import { logAudit } from "@/server/audit"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { brevoConfigured, brevoPersonalFrom, brevoReplyTo, sendTransactionalEmail } from "./brevo"
import { gmailAddress, hasGmailSend } from "@/server/google/gmail"
import { sendViaGmail } from "@/server/email/gmailSend"
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
 * (channel 'email'), then sends it. When Gmail send is enabled (Phase 2) it goes
 * THROUGH the support@ Gmail mailbox so the conversation stays unified there;
 * otherwise (or on Gmail failure) it falls back to Brevo's transactional API, and
 * to a logged mock when neither is configured. A relationship message, not bulk
 * marketing: no List-Unsubscribe header; opt-out is enforced by
 * `assertCanSendEmail`. Reply-To is the support@ Google Workspace mailbox, so the
 * recipient's reply lands in Gmail (and is mirrored back into this thread).
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

  // Phase 2: route 1:1 through Gmail when enabled, so the conversation stays
  // unified in the support@ mailbox and lands with Google-grade deliverability.
  // Falls back to Brevo if Gmail is off/unconfigured or the send fails — nothing
  // breaks while the read-mirror is still being verified.
  const brevoArgs = {
    to: check.email,
    subject: args.subject,
    text: outgoingText,
    html: wrappedHtml,
    replyTo,
    attachments: resolved.brevo,
    idempotencyKey: inserted.id,
  }
  let provider: ProviderResult
  let gmailThreadId: string | null = null
  if (hasGmailSend()) {
    const sent = await sendViaGmailPath({
      admin,
      contactId: args.contactId,
      excludeId: inserted.id,
      to: check.email,
      subject: args.subject,
      text: outgoingText,
      html: wrappedHtml,
      replyTo,
      resolved,
    })
    if (sent.ok) {
      provider = { id: sent.messageId, error: null, mock: false }
      gmailThreadId = sent.threadId
    } else {
      provider = await sendTransactionalOrMock(brevoArgs)
    }
  } else {
    provider = await sendTransactionalOrMock(brevoArgs)
  }

  const update: {
    provider_message_id: string | null
    status: string
    error: string | null
    email_meta?: Json
  } = {
    provider_message_id: provider.id,
    status: provider.error ? "failed" : provider.mock ? "mocked" : "sent",
    error: provider.error,
  }
  if (gmailThreadId) {
    const prior =
      emailMeta && typeof emailMeta === "object" && !Array.isArray(emailMeta) ? emailMeta : {}
    update.email_meta = { ...prior, source: "gmail", gmail_thread_id: gmailThreadId }
  }
  await admin.from("messages").update(update).eq("id", inserted.id)

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

/** Resolve the contact's current Gmail thread for reply threading. Excludes the
 *  message row we just inserted for this send. */
async function lookupGmailThread(
  admin: AdminClient,
  contactId: string,
  excludeId: string,
): Promise<{ threadId: string | null; messageId: string | null }> {
  const { data } = await admin
    .from("messages")
    .select("provider_message_id, email_meta")
    .eq("contact_id", contactId)
    .eq("channel", "email")
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return { threadId: null, messageId: null }
  const meta = (
    data.email_meta && typeof data.email_meta === "object" && !Array.isArray(data.email_meta)
      ? data.email_meta
      : {}
  ) as { gmail_thread_id?: string; message_id?: string }
  return {
    threadId: meta.gmail_thread_id ?? null,
    messageId: data.provider_message_id ?? meta.message_id ?? null,
  }
}

/** Send a 1:1 through Gmail (Phase 2): mint the Message-ID we'll store (so the
 *  mirror dedups our own Sent copy), thread under the contact's existing Gmail
 *  conversation, and map attachments to MIME parts. */
async function sendViaGmailPath(args: {
  admin: AdminClient
  contactId: string
  excludeId: string
  to: string
  subject: string
  text: string
  html: string | null
  replyTo: string
  resolved: { brevo: BrevoAttachment[]; meta: StoredAttachmentMeta[] }
}): Promise<{ ok: true; messageId: string; threadId: string } | { ok: false; error: string }> {
  const domain = gmailAddress().split("@")[1] || "ms.church"
  const messageId = `<${crypto.randomUUID()}@${domain}>`
  const prior = await lookupGmailThread(args.admin, args.contactId, args.excludeId)
  const attachments = args.resolved.brevo.map((b, i) => ({
    name: b.name,
    content: b.content,
    type: args.resolved.meta[i]?.type ?? "application/octet-stream",
  }))
  const res = await sendViaGmail({
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
    replyTo: args.replyTo,
    fromName: brevoPersonalFrom().name,
    messageId,
    attachments,
    threadId: prior.threadId,
    inReplyTo: prior.messageId,
    references: prior.messageId,
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, messageId, threadId: res.threadId }
}
