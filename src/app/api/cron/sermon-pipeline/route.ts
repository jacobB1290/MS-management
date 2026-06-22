import { NextResponse, type NextRequest } from "next/server"
import { runSermonPipeline } from "@/server/sermons/service"

/**
 * Weekly sermon-pipeline tick. Detects the newest service video, pulls its
 * captions, and segments the transcript with Claude, leaving the result at
 * status `review` for a human to publish. Idempotent: a video that's already
 * been processed is a clean no-op, so running this more often than weekly is
 * harmless (schedule it a few hours after the Sunday upload).
 *
 * Scheduled via Supabase pg_cron (same pattern as the Gmail mirror + campaign
 * worker). Auth: Bearer `CRON_SECRET` (must be on the Vercel PRODUCTION scope).
 * Fail-closed. The pipeline never throws — a failed run is recorded on
 * sermon_pipeline_runs and surfaced in the CRM monitor — so this stays green.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return new NextResponse("Cron not configured", { status: 503 })
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const result = await runSermonPipeline({ trigger: "cron" })
  return NextResponse.json({ ...result, ran_at: new Date().toISOString() })
}
