import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { verifyUnsubscribe } from "@/server/comms/emailAddress"

/**
 * Email unsubscribe endpoint referenced by the List-Unsubscribe header on
 * outbound 1:1 email.
 *   - POST: RFC 8058 one-click (the mailbox provider posts
 *     `List-Unsubscribe=One-Click`). No human in the loop.
 *   - GET: the recipient clicked the unsubscribe link in their mail client.
 *
 * The link is signed (HMAC of the contactId), so it can't be guessed or
 * iterated. Sets `email_unsubscribed_at` — the CRM's source of truth — which is
 * also what blocks future sends in `assertCanSendEmail`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function unsubscribe(request: NextRequest, source: string): Promise<boolean> {
  const c = request.nextUrl.searchParams.get("c")
  const t = request.nextUrl.searchParams.get("t")
  if (!c || !UUID_RE.test(c) || !verifyUnsubscribe(c, t)) return false

  const admin = createSupabaseAdminClient()
  await admin
    .from("contacts")
    .update({ email_unsubscribed_at: new Date().toISOString() })
    .eq("id", c)
    .is("email_unsubscribed_at", null)
  await logAudit({
    action: "contact.unsubscribe_email",
    targetTable: "contacts",
    targetId: c,
    diff: { source },
  })
  return true
}

export async function POST(request: NextRequest) {
  const ok = await unsubscribe(request, "list_unsubscribe_oneclick")
  return new NextResponse(ok ? "" : "Invalid link", { status: ok ? 200 : 403 })
}

export async function GET(request: NextRequest) {
  const ok = await unsubscribe(request, "list_unsubscribe_link")
  const message = ok
    ? "You have been unsubscribed. You will no longer receive email from us."
    : "This unsubscribe link is invalid or has expired."
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#2b2b2b"><p style="font-size:1.05rem;line-height:1.5">${message}</p></body></html>`
  return new NextResponse(html, {
    status: ok ? 200 : 403,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
