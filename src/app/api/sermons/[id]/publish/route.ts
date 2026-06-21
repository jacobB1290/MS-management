import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { publishSermon, unpublishSermon } from "@/server/sermons/service"

/**
 * Publish a reviewed sermon so it appears on ms.church (via the public feed),
 * or — with `?action=unpublish` — take it back down to review. Staff action;
 * publishing is deliberately human-gated (we never auto-publish AI output to the
 * live site).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const action = new URL(request.url).searchParams.get("action")

  const result =
    action === "unpublish"
      ? await unpublishSermon(id, user.id)
      : await publishSermon(id, user.id)

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "not_ready" ? 409 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, id: result.id })
}
