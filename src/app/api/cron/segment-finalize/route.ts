import { NextResponse, type NextRequest } from "next/server"
import { finalizeReturnedSegmentationJobs } from "@/server/sermons/segmentQueue"

/**
 * Segmentation finalize tick. Applies every `returned` segmentation_job (a Claude
 * Code session has handed back raw JSON): validate → run the same boundary-repair
 * the API path runs → write the sermon → status `review`, mark the job
 * `finalized`. So a session-segmented service goes live-ready within ~2 min of
 * the session handing it back, with NO CRM instance open.
 *
 * Scheduled every 2 min by Supabase pg_cron (migration 0043). Auth: Bearer
 * `CRON_SECRET` (Vercel PRODUCTION scope). Fail-closed. Never throws — a bad
 * result marks that one job `error` and is surfaced; the rest proceed — so this
 * stays green. Idempotent + self-throttling: no returned jobs is a clean no-op.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return new NextResponse("Cron not configured", { status: 503 })
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const result = await finalizeReturnedSegmentationJobs()
  return NextResponse.json({ ...result, ran_at: new Date().toISOString() })
}
