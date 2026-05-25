import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { inquiryReplySchema } from "@/server/validation/schemas"
import { sendSms } from "@/server/comms/sendSms"

/**
 * Reply by text to an inquiry. Uses the transactional_inquiry consent basis:
 * the contact asked the question, so an answer is informational, not marketing.
 * Passes through the central send gate (STOP always honored) and is recorded as
 * a normal message.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params
  const parsed = inquiryReplySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  const { data: inq } = await admin
    .from("inquiries")
    .select("contact_id")
    .eq("id", id)
    .maybeSingle()
  if (!inq) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (!inq.contact_id) return NextResponse.json({ error: "no_contact" }, { status: 400 })

  const result = await sendSms({
    contactId: inq.contact_id,
    body: parsed.data.body,
    sentByUserId: user.id,
    context: "transactional_inquiry",
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }

  return NextResponse.json({ ok: true, mock: result.mock })
}
