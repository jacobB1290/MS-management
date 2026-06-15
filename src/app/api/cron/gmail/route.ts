import { NextResponse, type NextRequest } from "next/server"
import { syncGmailMailbox } from "@/server/email/gmailSync"

/**
 * Dedicated Gmail-mirror tick, driven by Supabase pg_cron every ~60s (see
 * migration 0033). Decoupled from the campaign worker so it can run every minute
 * cheaply. The sync is INCREMENTAL (Gmail history.list from the stored cursor),
 * so an idle tick is a single tiny history call + cursor touch — not a re-scan —
 * and a no-op entirely when Gmail isn't configured.
 *
 * Auth: Bearer `CRON_SECRET` (must be on the Vercel PRODUCTION scope). Fail-closed.
 */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return new NextResponse("Cron not configured", { status: 503 })
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const gmail = await syncGmailMailbox()
  return NextResponse.json({ ok: true, gmail, ran_at: new Date().toISOString() })
}
