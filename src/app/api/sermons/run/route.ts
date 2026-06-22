import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { runSermonPipeline } from "@/server/sermons/service"

/**
 * Manually run the sermon pipeline from the CRM "Sermons" tab — for the newest
 * video (no body), a specific `videoId`, or to re-run an existing one with
 * `force: true`. Staff-only; the work is the same orchestrator the cron uses,
 * so a manual run records a `sermon_pipeline_runs` row exactly like an automated
 * one (trigger = "manual").
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let body: { videoId?: string; force?: boolean } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // empty body = run latest
  }

  const result = await runSermonPipeline({
    trigger: "manual",
    userId: user.id,
    videoId: typeof body.videoId === "string" && body.videoId.trim() ? body.videoId.trim() : undefined,
    force: body.force === true,
  })

  // The pipeline records failures rather than throwing; surface a 502 so the UI
  // can toast, but the run row is already written for the monitor.
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 })
  }
  return NextResponse.json(result)
}
