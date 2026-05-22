import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { logAudit } from "@/server/audit"

const bodySchema = z.object({
  channel: z.enum(["sms", "email"]),
  opted_out: z.boolean(),
})

/**
 * Toggle a contact's SMS opt-out or email unsubscribe. Both members and
 * admins can do this (the brief calls it "yes-with-confirmation-and-audit");
 * the confirmation lives in the UI, this endpoint always audits.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireStaff()
  const { id } = await params

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }

  const now = parsed.data.opted_out ? new Date().toISOString() : null
  const admin = createSupabaseAdminClient()
  const update =
    parsed.data.channel === "sms"
      ? { sms_opted_out_at: now }
      : { email_unsubscribed_at: now }
  const { error } = await admin.from("contacts").update(update).eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAudit({
    action:
      parsed.data.channel === "sms"
        ? parsed.data.opted_out
          ? "contact.opt_out_sms"
          : "contact.opt_in_sms"
        : "contact.unsubscribe_email",
    actorUserId: user.id,
    targetTable: "contacts",
    targetId: id,
    diff: { channel: parsed.data.channel, opted_out: parsed.data.opted_out, source: "manual_staff" },
  })

  return NextResponse.json({ ok: true })
}
