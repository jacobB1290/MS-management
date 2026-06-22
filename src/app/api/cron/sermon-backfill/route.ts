import { NextResponse, type NextRequest } from "next/server"
import { drainNextBackfill } from "@/server/sermons/backfill"

/**
 * Back-catalog drain tick. Claims and processes ONE pending item from
 * `sermon_backfill_queue` (transcribe → segment → status `review`), then returns.
 * Scheduled every 5 min by Supabase pg_cron (migration 0039) so the whole back
 * catalog processes server-side with NO CRM instance open — the autonomy
 * requirement. Idempotent + self-throttling: an empty queue is a clean no-op, so
 * running it more often is harmless.
 *
 * Auth: Bearer `CRON_SECRET` (Vercel PRODUCTION scope). Fail-closed. The drain
 * never throws — a failed item is marked `failed` on its queue row and surfaced
 * in the CRM picker — so this stays green.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return new NextResponse("Cron not configured", { status: 503 })
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const result = await drainNextBackfill()
  return NextResponse.json({ ...result, ran_at: new Date().toISOString() })
}
