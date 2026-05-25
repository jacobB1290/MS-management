import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { prayerEncourageSchema } from "@/server/validation/schemas"
import { sendSms } from "@/server/comms/sendSms"

/**
 * Send a one-off encouragement text tied to a prayer request. Uses the
 * transactional_prayer consent basis: the contact asked for prayer, so this is
 * an informational reply, not marketing. The send still passes through the
 * central gate (STOP is always honored) and is recorded as a normal message.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const parsed = prayerEncourageSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: pr } = await admin
    .from("prayer_requests")
    .select("contact_id")
    .eq("id", id)
    .maybeSingle()
  if (!pr) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (!pr.contact_id) return NextResponse.json({ error: "no_contact" }, { status: 400 })

  const result = await sendSms({
    contactId: pr.contact_id,
    body: parsed.data.body,
    sentByUserId: user.id,
    context: "transactional_prayer",
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }

  return NextResponse.json({ ok: true, mock: result.mock })
}
