import { NextResponse } from "next/server"
import { requireStaff } from "@/server/auth"
import { syncEventsFromCalendar } from "@/server/events/service"

/**
 * Pull the church Google Calendar into the CRM: import events created directly
 * in Calendar, refresh published rows, and mark vanished events cancelled.
 * Staff-triggered from the events list (and reusable by a future cron).
 */
export async function POST() {
  const user = await requireStaff()
  const result = await syncEventsFromCalendar(user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json(result)
}
