import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { eventCreateSchema } from "@/server/validation/schemas"
import { createEvent } from "@/server/events/service"

export async function POST(request: NextRequest) {
  const user = await requireStaff()

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = eventCreateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await createEvent(parsed.data, user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: result.id }, { status: 201 })
}
