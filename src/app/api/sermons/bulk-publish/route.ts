import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { bulkPublishSermons } from "@/server/sermons/backfill"

/**
 * Publish many reviewed sermons in one action — the backfill "review then bulk
 * publish" step. Each goes through the same human-gated `publishSermon` (we
 * never auto-publish AI output); this just batches the click. Staff-only.
 */
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let body: { ids?: string[] } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: "no_ids" }, { status: 400 })
  }

  const result = await bulkPublishSermons(ids, user.id)
  return NextResponse.json(result)
}
