import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { sendPushToStaff } from "@/server/push/send"
import { organizeConversation } from "@/server/ai/organizeInbound"
import {
  extractBodies,
  getMessage,
  getProfile,
  gmailAddress,
  hasGmailSync,
  headerValue,
  listHistory,
  listMessages,
  parseEmailAddress,
} from "@/server/google/gmail"

/**
 * Mirror the support@ms.church Gmail mailbox into the CRM so a contact's thread
 * shows the FULL email conversation — inbound replies AND anything composed in
 * Gmail — regardless of how it was sent. Brevo sends blasts; Gmail is the system
 * of record for 1:1; this keeps the CRM in sync with Gmail.
 *
 * Cursor (the Gmail `historyId`) lives in `app_settings`. First run anchors the
 * cursor and backfills a recent window; subsequent runs are incremental via the
 * history API. Idempotent on the RFC `Message-ID` (the messages partial unique
 * index), so re-runs never duplicate. Threads only to EXISTING contacts matched
 * by email — mailbox noise (vendors, newsletters) never spawns junk contacts.
 */

const CURSOR_KEY = "gmail_sync"
// First-run backfill window — bounded so the initial run fits the cron budget.
const BACKFILL_QUERY = "newer_than:14d -in:chats"
const BACKFILL_CAP = 100

type Admin = ReturnType<typeof createSupabaseAdminClient>

export type GmailSyncResult =
  | { ok: true; mock: true }
  | { ok: true; processed: number; threaded: number; historyId: string | null }
  | { ok: false; error: string }

export async function syncGmailMailbox(): Promise<GmailSyncResult> {
  if (!hasGmailSync()) return { ok: true, mock: true }
  const admin = createSupabaseAdminClient()

  try {
    const cursor = await readCursor(admin)
    const ids: string[] = []
    let newHistoryId: string | null = null
    // First run notifies nobody: backfilling old mail shouldn't fire a flood of
    // push notifications. Only genuinely new (incremental) inbound notifies.
    const firstRun = !cursor

    if (firstRun) {
      let pageToken: string | undefined
      do {
        const page = await listMessages(BACKFILL_QUERY, pageToken)
        for (const m of page.messages ?? []) ids.push(m.id)
        pageToken = page.nextPageToken
      } while (pageToken && ids.length < BACKFILL_CAP)
      newHistoryId = (await getProfile()).historyId
    } else {
      let pageToken: string | undefined
      do {
        const page = await listHistory(cursor, pageToken)
        for (const h of page.history ?? []) {
          for (const a of h.messagesAdded ?? []) ids.push(a.message.id)
        }
        if (page.historyId) newHistoryId = page.historyId
        pageToken = page.nextPageToken
      } while (pageToken)
      if (!newHistoryId) newHistoryId = cursor
    }

    const unique = [...new Set(ids)].slice(0, BACKFILL_CAP)
    let threaded = 0
    for (const id of unique) {
      if (await threadMessage(admin, id, !firstRun)) threaded += 1
    }

    if (newHistoryId) await writeCursor(admin, newHistoryId)

    // Audit only ticks that did something — a 1-minute idle poll must not spam the
    // log. (Errors are audited in the catch; the cursor's updated_at is the
    // heartbeat that proves the poll is alive.)
    if (threaded > 0) {
      await logAudit({
        action: "gmail.sync",
        diff: { processed: unique.length, threaded, history_id: newHistoryId },
      })
    }
    return { ok: true, processed: unique.length, threaded, historyId: newHistoryId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    // A 404 means the cursor is older than Gmail's history retention; reset so
    // the next run re-anchors instead of wedging forever.
    if (/\b404\b/.test(error)) await clearCursor(admin)
    await logAudit({ action: "gmail.sync", diff: { error } })
    return { ok: false, error }
  }
}

/** Thread one Gmail message into the CRM. Returns true only on a NEW insert. */
async function threadMessage(admin: Admin, gmailId: string, notify: boolean): Promise<boolean> {
  const msg = await getMessage(gmailId)
  const messageId =
    headerValue(msg, "Message-ID") ?? headerValue(msg, "Message-Id") ?? `gmail:${gmailId}`
  const fromAddr = parseEmailAddress(headerValue(msg, "From"))
  const toAddr = parseEmailAddress(headerValue(msg, "To"))
  const subject = headerValue(msg, "Subject")?.slice(0, 200) ?? null

  const our = gmailAddress()
  const direction: "in" | "out" = fromAddr === our ? "out" : "in"
  // The contact is the OTHER party in the exchange.
  const counterpart = direction === "out" ? toAddr : fromAddr
  if (!counterpart || counterpart === our) return false

  // Match an EXISTING contact only (don't auto-create from arbitrary mailbox mail).
  const { data: contact } = await admin
    .from("contacts")
    .select("id, name")
    .eq("email", counterpart)
    .maybeSingle()
  if (!contact) return false

  const { text, html } = extractBodies(msg.payload)
  const body = direction === "in" ? stripQuotedReply(text ?? "") : (text ?? "").trim()
  const occurredAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString()

  const { data: inserted, error: msgErr } = await admin
    .from("messages")
    .insert({
      contact_id: contact.id,
      direction,
      body: body || (subject ? `(${subject})` : "(no text)"),
      body_html: html,
      subject,
      channel: "email",
      provider_message_id: messageId,
      status: direction === "in" ? "received" : "sent",
      created_at: occurredAt,
      email_meta: {
        source: "gmail",
        gmail_id: gmailId,
        gmail_thread_id: msg.threadId,
        from: fromAddr,
        to: toAddr,
        message_id: messageId,
      },
    })
    .select("id")
    .maybeSingle()

  if (msgErr) {
    // 23505 = unique violation = already mirrored. Treat as a no-op.
    if ((msgErr as { code?: string }).code?.startsWith("23")) return false
    throw new Error(`gmail_thread_insert: ${msgErr.message}`)
  }
  if (!inserted) return false

  // Inbound, genuinely-new mail: notify staff + run the AI triage (no-op when AI
  // is off). Suppressed on backfill and for our own outbound.
  if (direction === "in" && notify) {
    try {
      await sendPushToStaff({
        title: contact.name || counterpart,
        body: (subject ? `${subject}: ${body}` : body).slice(0, 140) || "New email",
        url: `/inbox?c=${contact.id}`,
        tag: `contact-${contact.id}`,
      })
    } catch {
      /* delivery is best-effort */
    }
    await organizeConversation(contact.id, {
      source: "email_inbound",
      messageSid: messageId,
      channel: "email",
    })
  }
  return true
}

// --- quoted-reply stripping (inbound display only) --------------------------

const SEPARATORS: RegExp[] = [
  /^On .+ wrote:$/,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{5,}$/,
  /^From:\s.+/i,
  /^.*\b\d{1,2}:\d{2}\s?(AM|PM)\b.*wrote:$/i,
]

function stripQuotedReply(text: string): string {
  if (!text) return ""
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith(">")) break
    if (SEPARATORS.some((re) => re.test(t))) break
    kept.push(line)
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

// --- cursor (app_settings) --------------------------------------------------

async function readCursor(admin: Admin): Promise<string | null> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", CURSOR_KEY)
    .maybeSingle()
  const v = data?.value as { historyId?: string } | null
  return v?.historyId ?? null
}

async function writeCursor(admin: Admin, historyId: string): Promise<void> {
  await admin
    .from("app_settings")
    .upsert(
      { key: CURSOR_KEY, value: { historyId, updated_at: new Date().toISOString() } },
      { onConflict: "key" },
    )
}

async function clearCursor(admin: Admin): Promise<void> {
  await admin.from("app_settings").delete().eq("key", CURSOR_KEY)
}
