import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { publishEvent, cancelEvent } from "@/server/events/service"

/**
 * Publish (or re-publish) an event to the church calendar so it appears on
 * ms.church, or — with `?action=cancel` — take it back down. Both are staff
 * actions; the heavy lifting (Drive upload + calendar write) is in the service.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const action = new URL(request.url).searchParams.get("action")

  const result =
    action === "cancel" ? await cancelEvent(id, user.id) : await publishEvent(id, user.id)

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, id: result.id, mock: result.mock })
}
