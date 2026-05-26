import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { voiceTokenSchema } from "@/server/validation/schemas"
import { getVoiceConfig, mintVoiceAccessToken } from "@/server/comms/voice"
import { logAudit } from "@/server/audit"

/**
 * Mint a short-lived Twilio Voice AccessToken for a browser-based outbound
 * call to one contact. Staff-gated. The token only carries an outgoing grant
 * scoped to our TwiML App — it cannot be used to do anything else.
 *
 * Voice is separate from SMS opt-out: we require a phone on file but do NOT
 * block on `sms_opted_out_at`. The audit row records the call start here, at
 * the moment the operator commits to dialing.
 */
export async function POST(request: NextRequest) {
  const user = await requireStaff()

  const config = getVoiceConfig()
  if (!config) {
    return NextResponse.json({ error: "voice_not_configured" }, { status: 503 })
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsed = voiceTokenSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: contact, error } = await admin
    .from("contacts")
    .select("id, phone")
    .eq("id", parsed.data.contact_id)
    .maybeSingle()

  if (error || !contact) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  if (!contact.phone) {
    return NextResponse.json({ error: "no_phone" }, { status: 422 })
  }

  // Identity is the staff user — namespaced so it's obvious in Twilio logs.
  // Twilio Voice client identities allow only [A-Za-z0-9._-] (the UUID's own
  // hyphens are fine); a colon separator produces a malformed `client:` address
  // that fails Device registration, so use an underscore.
  const minted = mintVoiceAccessToken({
    config,
    identity: `staff_${user.id}`,
  })

  await logAudit({
    action: "call.start",
    actorUserId: user.id,
    targetTable: "contacts",
    targetId: contact.id,
    diff: { to: contact.phone, channel: "voice" },
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({
    token: minted.token,
    identity: minted.identity,
    expires_at: minted.expiresAt,
    to: contact.phone,
  })
}
