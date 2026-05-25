import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { assertCanSendSms, type SmsSkipReason, type SendContext } from "./optOut"
import { logAudit } from "@/server/audit"

/**
 * Canonical 1:1 SMS send path. Every SMS the operator UI sends goes through
 * here. Enforces opt-out at the function level (not just the UI button),
 * inserts the outbound message row, then calls Twilio — or skips the
 * provider call entirely if no credentials are configured (mock mode).
 *
 * Returns the inserted message id and the provider sid (null in mock mode).
 */
export async function sendSms(args: {
  contactId: string
  body: string
  mediaUrl?: string | null
  sentByUserId?: string | null
  campaignId?: string | null
  /** Consent context for the send gate. Defaults: campaign → marketing,
   *  otherwise a 1:1 conversational reply. */
  context?: SendContext
}): Promise<SendSmsResult> {
  const context: SendContext =
    args.context ?? (args.campaignId ? "marketing_promotional" : "conversational_reply")
  const check = await assertCanSendSms(args.contactId, context)
  if (!check.ok) {
    return { ok: false, reason: check.reason }
  }

  const admin = createSupabaseAdminClient()
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      contact_id: args.contactId,
      direction: "out",
      body: args.body,
      media_url: args.mediaUrl ?? null,
      channel: args.mediaUrl ? "mms" : "sms",
      status: "queued",
      context,
      campaign_id: args.campaignId ?? null,
      sent_by: args.sentByUserId ?? null,
    })
    .select("id")
    .single()

  if (insertErr || !inserted) {
    return { ok: false, reason: "db_insert_failed", detail: insertErr?.message }
  }

  const provider = await callTwilioOrMock({
    to: check.phone,
    body: args.body,
    mediaUrl: args.mediaUrl ?? null,
  })

  await admin
    .from("messages")
    .update({
      twilio_sid: provider.sid,
      status: provider.status,
      error: provider.error,
    })
    .eq("id", inserted.id)

  await logAudit({
    action: provider.error ? "message.send_failed" : "message.send",
    actorUserId: args.sentByUserId ?? null,
    targetTable: "messages",
    targetId: inserted.id,
    diff: {
      contact_id: args.contactId,
      campaign_id: args.campaignId ?? null,
      provider_sid: provider.sid,
      mock: provider.mock,
    },
  })

  return {
    ok: true,
    messageId: inserted.id,
    providerSid: provider.sid,
    mock: provider.mock,
  }
}

export type SendSmsResult =
  | { ok: true; messageId: string; providerSid: string | null; mock: boolean }
  | { ok: false; reason: SmsSkipReason | "db_insert_failed" | "provider_failed"; detail?: string }

interface ProviderResult {
  sid: string | null
  status: string
  error: string | null
  mock: boolean
}

async function callTwilioOrMock(args: {
  to: string
  body: string
  mediaUrl: string | null
}): Promise<ProviderResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  // Mock mode: no credentials configured. Record the message as 'mocked'.
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    return {
      sid: `MOCK_${crypto.randomUUID()}`,
      status: "mocked",
      error: null,
      mock: true,
    }
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
    const form = new URLSearchParams()
    form.set("To", args.to)
    form.set("Body", args.body)
    if (args.mediaUrl) form.set("MediaUrl", args.mediaUrl)
    if (messagingServiceSid) {
      form.set("MessagingServiceSid", messagingServiceSid)
    } else if (fromNumber) {
      form.set("From", fromNumber)
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    })

    const json = (await res.json()) as { sid?: string; status?: string; message?: string; code?: number }
    if (!res.ok) {
      return {
        sid: null,
        status: "failed",
        error: json.message ?? `Twilio ${res.status}`,
        mock: false,
      }
    }
    return {
      sid: json.sid ?? null,
      status: json.status ?? "queued",
      error: null,
      mock: false,
    }
  } catch (err) {
    return {
      sid: null,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      mock: false,
    }
  }
}
