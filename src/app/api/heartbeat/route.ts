import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Daily liveness ping. Updates the singleton heartbeat row so the free-tier
 * Supabase project doesn't pause after 7 days. Either Vercel Cron or the
 * GitHub Actions workflow at `.github/workflows/heartbeat.yml` calls this.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return new NextResponse("Cron not configured", { status: 503 })
  }
  if (provided !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const admin = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await admin
    .from("heartbeat")
    .update({ last_run_at: nowIso })
    .eq("id", 1)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, last_run_at: nowIso })
}
