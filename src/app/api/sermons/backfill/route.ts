import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import {
  listBackfillCandidates,
  enqueueBackfill,
} from "@/server/sermons/backfill"

/**
 * Back-catalog picker API for the CRM "Process past services" view.
 *  - GET  → the full playlist crossed with what's already processed/queued, for
 *           the picker + live progress polling while the worker drains.
 *  - POST → enqueue the selected past videos. The pg_cron worker
 *           (/api/cron/sermon-backfill) processes them one per tick, server-side.
 * Staff-only. Enqueue is idempotent (re-arms failed/skipped, leaves active rows).
 */
export const maxDuration = 60

export async function GET() {
  await requireStaff()
  const listing = await listBackfillCandidates()
  return NextResponse.json(listing)
}

export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let body: {
    videos?: { videoId: string; title?: string | null; publishedAt?: string | null }[]
  } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const videos = Array.isArray(body.videos)
    ? body.videos.filter(
        (v): v is { videoId: string; title?: string | null; publishedAt?: string | null } =>
          Boolean(v && typeof v.videoId === "string" && v.videoId.trim()),
      )
    : []
  if (videos.length === 0) {
    return NextResponse.json({ error: "no_videos" }, { status: 400 })
  }

  const result = await enqueueBackfill(videos, user.id)
  return NextResponse.json(result)
}
