import "server-only"
import { assertCanSendEmail } from "./optOut"
import { logAudit } from "@/server/audit"

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
