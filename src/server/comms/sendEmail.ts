import "server-only"
import { assertCanSendEmail } from "./optOut"
import { logAudit } from "@/server/audit"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { replyToAddress, unsubscribeHeaders } from "./emailAddress"

/**
 * Canonical email send path. Uses SendGrid Dynamic Templates by ID; we
 * never compose marketing HTML in app code. Mock mode applies when keys
 * are absent.
 */
export async function sendEmail(args: {
  contactId: string
  templateId: string
  subject: string
  dynamicData?: Record<string, unknown>
  sentByUserId?: string | null
  campaignId?: string | null
}): Promise<SendEmailResult> {
  // CAN-SPAM: bulk email MUST carry a working unsubscribe mechanism. We
  // refuse rather than silently send without one. (1:1 transactional email
  // without a campaign is also exempt from the strict bulk rules, so the
  // group is only required when this send is part of a campaign.)
  if (args.campaignId && !process.env.SENDGRID_UNSUBSCRIBE_GROUP_ID) {
    return {
      ok: false,
      reason: "provider_failed",
      detail:
        "SENDGRID_UNSUBSCRIBE_GROUP_ID is not set — bulk email is refused for CAN-SPAM compliance.",
    }
  }

  const check = await assertCanSendEmail(args.contactId)
  if (!check.ok) return { ok: false, reason: check.reason }

  const provider = await callSendGridOrMock({
    to: check.email,
    templateId: args.templateId,
    subject: args.subject,
    dynamicData: args.dynamicData ?? {},
  })

  await logAudit({
    action: provider.error ? "message.send_failed" : "message.send",
    actorUserId: args.sentByUserId ?? null,
    targetTable: "contacts",
    targetId: args.contactId,
    diff: {
      channel: "email",
      template_id: args.templateId,
      campaign_id: args.campaignId ?? null,
      provider_id: provider.id,
      mock: provider.mock,
    },
  })

  if (provider.error) {
    return { ok: false, reason: "provider_failed", detail: provider.error }
  }
  return { ok: true, providerId: provider.id, mock: provider.mock }
}

export type SendEmailResult =
  | { ok: true; providerId: string | null; mock: boolean }
  | { ok: false; reason: "not_found" | "no_channel" | "unsubscribed" | "provider_failed"; detail?: string }

/**
 * Canonical 1:1 conversational email send. Mirrors `sendSms`: enforces opt-out
 * at the function level, logs the outbound row into the SAME `messages` thread
 * (channel 'email'), then calls SendGrid — or records a mock when keys are
 * absent. Unlike `sendEmail`, this composes a plain-text transactional reply
 * (no Dynamic Template); it is a relationship message, not bulk marketing, so
 * no unsubscribe group is required. The tokenized Reply-To routes the contact's
 * reply back into this thread via the Inbound Parse webhook.
 */
export async function sendDirectEmail(args: {
  contactId: string
  subject: string
  body: string
  sentByUserId?: string | null
}): Promise<SendDirectEmailResult> {
  const check = await assertCanSendEmail(args.contactId)
  if (!check.ok) return { ok: false, reason: check.reason }

  const admin = createSupabaseAdminClient()
  const replyTo = replyToAddress(args.contactId)
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      contact_id: args.contactId,
      direction: "out",
      body: args.body,
      subject: args.subject,
      channel: "email",
      status: "queued",
      context: "conversational_reply",
      sent_by: args.sentByUserId ?? null,
      email_meta: replyTo ? { reply_to: replyTo } : null,
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return { ok: false, reason: "db_insert_failed", detail: insertErr?.message }
  }

  const provider = await sendPlainEmailOrMock({
    to: check.email,
    subject: args.subject,
    body: args.body,
    replyTo,
    headers: unsubscribeHeaders(args.contactId),
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
      reason: "not_found" | "no_channel" | "unsubscribed" | "db_insert_failed" | "provider_failed"
      detail?: string
    }

async function sendPlainEmailOrMock(args: {
  to: string
  subject: string
  body: string
  replyTo: string | null
  headers: Record<string, string> | null
}): Promise<ProviderResult> {
  const apiKey = process.env.SENDGRID_API_KEY
  const fromEmail = process.env.SENDGRID_FROM_EMAIL
  const fromName = process.env.SENDGRID_FROM_NAME || "Morning Star Church"

  if (!apiKey || !fromEmail) {
    return { id: `MOCK_${crypto.randomUUID()}`, error: null, mock: true }
  }

  try {
    const payload = {
      from: { email: fromEmail, name: fromName },
      ...(args.replyTo ? { reply_to: { email: args.replyTo } } : {}),
      personalizations: [{ to: [{ email: args.to }] }],
      subject: args.subject,
      content: [{ type: "text/plain", value: args.body }],
      ...(args.headers ? { headers: args.headers } : {}),
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      return { id: null, error: `SendGrid ${res.status}: ${text}`, mock: false }
    }
    return { id: res.headers.get("x-message-id"), error: null, mock: false }
  } catch (err) {
    return {
      id: null,
      error: err instanceof Error ? err.message : String(err),
      mock: false,
    }
  }
}

interface ProviderResult {
  id: string | null
  error: string | null
  mock: boolean
}

async function callSendGridOrMock(args: {
  to: string
  templateId: string
  subject: string
  dynamicData: Record<string, unknown>
}): Promise<ProviderResult> {
  const apiKey = process.env.SENDGRID_API_KEY
  const fromEmail = process.env.SENDGRID_FROM_EMAIL
  const fromName = process.env.SENDGRID_FROM_NAME || "Morning Star Church"
  const unsubGroupId = process.env.SENDGRID_UNSUBSCRIBE_GROUP_ID

  if (!apiKey || !fromEmail) {
    return { id: `MOCK_${crypto.randomUUID()}`, error: null, mock: true }
  }

  try {
    const physicalAddress =
      process.env.PHYSICAL_MAILING_ADDRESS ?? "3080 N Wildwood St, Boise, ID 83713"
    const payload = {
      from: { email: fromEmail, name: fromName },
      personalizations: [
        {
          to: [{ email: args.to }],
          dynamic_template_data: {
            ...args.dynamicData,
            // CAN-SPAM: physical mailing address available to every template
            mailing_address: physicalAddress,
          },
        },
      ],
      template_id: args.templateId,
      subject: args.subject,
      ...(unsubGroupId
        ? { asm: { group_id: Number(unsubGroupId) } }
        : {}),
    }

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      return { id: null, error: `SendGrid ${res.status}: ${text}`, mock: false }
    }
    // SendGrid returns an X-Message-Id header on success.
    const messageId = res.headers.get("x-message-id")
    return { id: messageId, error: null, mock: false }
  } catch (err) {
    return {
      id: null,
      error: err instanceof Error ? err.message : String(err),
      mock: false,
    }
  }
}
