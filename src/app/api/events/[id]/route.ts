import { NextResponse, type NextRequest } from "next/server"
import { requireStaff, requireAdmin } from "@/server/auth"
import { eventUpdateSchema } from "@/server/validation/schemas"
import { updateEvent, deleteEvent } from "@/server/events/service"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = eventUpdateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await updateEvent(id, parsed.data, user.id)
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, id: result.id, mock: result.mock })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Deleting removes the event from the public calendar + Drive — admin only,
  // matching the events_admin_delete RLS policy.
  const user = await requireAdmin()
  const { id } = await params

  const result = await deleteEvent(id, user.id)
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
