import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { proposePromotion } from "@/server/events/promote"

/**
 * "Promote with AI": Opus reads the event flyer + audience and returns a full
 * campaign plan (message, audience, schedule). The composer pre-fills from it;
 * the operator still reviews and sends. 503 when AI isn't configured.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const result = await proposePromotion(id, user.id)
  if (!result.ok) {
    const status =
      result.reason === "disabled" ? 503 : result.reason === "not_found" ? 404 : 502
    return NextResponse.json({ error: result.reason, detail: result.detail }, { status })
  }
  return NextResponse.json({ ok: true, proposal: result.proposal })
}
