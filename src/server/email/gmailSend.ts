import "server-only"
import { gmailAddress, sendRawMessage } from "@/server/google/gmail"

/** A file attachment for a Gmail send (base64-encoded content). */
export interface GmailSendAttachment {
  name: string
  type: string
  content: string
}

export interface GmailSendArgs {
  to: string
  subject: string
  text: string
  html: string | null
  replyTo: string
  fromName: string
  /** The RFC Message-ID we embed and store, so the Phase-1 mirror dedups our own
   *  Sent copy instead of threading it twice. */
  messageId: string
  attachments: GmailSendAttachment[]
  threadId?: string | null
  inReplyTo?: string | null
  references?: string | null
}

export type GmailSendResult =
  | { ok: true; messageId: string; gmailId: string; threadId: string }
  | { ok: false; error: string }

/**
 * Send a 1:1 personal email THROUGH the support@ms.church Gmail mailbox (Phase 2).
 * The message lands natively in the Gmail thread (and Sent), so the conversation
 * stays unified in one mailbox; the CRM threads its own copy immediately and the
 * Phase-1 mirror dedups on the shared Message-ID.
 */
export async function sendViaGmail(args: GmailSendArgs): Promise<GmailSendResult> {
  try {
    const raw = buildRawMessage(args)
    const res = await sendRawMessage(raw, args.threadId ?? undefined)
    return { ok: true, messageId: args.messageId, gmailId: res.id, threadId: res.threadId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function buildRawMessage(args: GmailSendArgs): string {
  const from = `${encodeDisplayName(args.fromName)} <${gmailAddress()}>`
  const alt = `alt_${rand()}`
  const mixed = `mix_${rand()}`
  const hasAtt = args.attachments.length > 0

  const headers: string[] = [
    `From: ${from}`,
    `To: ${args.to}`,
    `Reply-To: ${args.replyTo}`,
    `Subject: ${encodeSubject(args.subject)}`,
    `Message-ID: ${args.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
  ]
  if (args.inReplyTo) headers.push(`In-Reply-To: ${args.inReplyTo}`)
  if (args.references) headers.push(`References: ${args.references}`)

  const altPart = [
    `--${alt}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(toB64(args.text)),
    `--${alt}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap76(toB64(args.html ?? args.text)),
    `--${alt}--`,
  ].join("\r\n")

  let body: string
  if (hasAtt) {
    headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`)
    const parts: string[] = [
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      ``,
      altPart,
    ]
    for (const a of args.attachments) {
      const name = sanitizeName(a.name)
      parts.push(
        `--${mixed}`,
        `Content-Type: ${a.type}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        wrap76(a.content),
      )
    }
    parts.push(`--${mixed}--`)
    body = parts.join("\r\n")
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${alt}"`)
    body = altPart
  }

  const message = `${headers.join("\r\n")}\r\n\r\n${body}`
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function rand(): string {
  return Math.random().toString(36).slice(2, 12)
}
function toB64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64")
}
function wrap76(b64: string): string {
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76))
  return lines.join("\r\n")
}
function sanitizeName(n: string): string {
  return n.replace(/[\r\n"]/g, "").slice(0, 200)
}
function isAscii(s: string): boolean {
  return /^[\x20-\x7E]*$/.test(s)
}
function encodeSubject(s: string): string {
  return isAscii(s) ? s : `=?UTF-8?B?${toB64(s)}?=`
}
function encodeDisplayName(s: string): string {
  if (!isAscii(s)) return `=?UTF-8?B?${toB64(s)}?=`
  return /[",:;<>@()]/.test(s) ? `"${s.replace(/"/g, "")}"` : s
}
