import { NextResponse, type NextRequest } from "next/server"
import { finalizeReturnedSegmentationJobs } from "@/server/sermons/segmentQueue"
import { recoverStuckSermonRuns } from "@/server/sermons/service"

/**
 * Segmentation finalize + stuck-run recovery tick. Two jobs on one 2-min cron:
 *
 * 1. Finalize: applies every `returned` segmentation_job (a Claude Code session
 *    has handed back raw JSON): validate → run the same boundary-repair the API
 *    path runs → write the sermon → status `review`, mark the job `finalized`.
 *    So a session-segmented service goes live-ready within ~2 min of the session
 *    handing it back, with NO CRM instance open.
 *
 * 2. Recover: heals pipeline runs orphaned by a function timeout / crash (a long
 *    API segment call killed at Vercel's 300s limit never returns, so the run
 *    stays 'running' and the sermon is frozen at 'segmenting'). This sweep marks
 *    the dead run failed and un-sticks the sermon — promoting to `review` if the
 *    chapters already landed, or auto-routing a true segment-timeout to the
 *    limitless Claude Code session path (same as a max_tokens overrun). That is
 *    the systemic fix, not a one-off un-stick.
 *
 * Scheduled every 2 min by Supabase pg_cron (migration 0043). Auth: Bearer
 * `CRON_SECRET` (Vercel PRODUCTION scope). Fail-closed. Never throws — a bad
 * result marks that one job `error` and is surfaced; the rest proceed — so this
 * stays green. Idempotent + self-throttling: nothing to do is a clean no-op.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return new NextResponse("Cron not configured", { status: 503 })
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  // Recover orphaned runs FIRST: a stuck 'segmenting' run that re-routes to the
  // session path parks a fresh job, which this same tick's finalize pass cannot
  // complete yet (the session hasn't run) — but promoting an already-chaptered
  // stuck sermon to `review` is immediate, and recovery never blocks finalize.
  const recovery = await recoverStuckSermonRuns()
  const finalize = await finalizeReturnedSegmentationJobs()
  return NextResponse.json({ ...finalize, recovery, ran_at: new Date().toISOString() })
}
