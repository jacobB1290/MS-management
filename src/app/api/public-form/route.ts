import { NextResponse, type NextRequest } from "next/server"
import { verifyHmacRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { publicFormSubmissionSchema } from "@/server/validation/schemas"
import { logAudit } from "@/server/audit"

const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Public website form receiver. The website POSTs JSON signed with
 * PUBLIC_FORM_HMAC_SECRET; the JSON body must include `_ts` (unix ms) and
 * `_nonce` so we can refuse replays. Behavior:
 *   1. Verify HMAC.
 *   2. Reject if `_ts` is more than 5 minutes off (clock skew window).
 *   3. Reject if `_nonce` has been seen in the last 24h (idempotency).
 *   4. Insert form_submissions (immutable audit row).
 *   5. Atomic contact upsert via the SQL RPC.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const verify = verifyHmacRequest(request, rawBody)
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const envelope = json as { _ts?: number; _nonce?: string } | null
  if (!envelope?._ts || !envelope?._nonce) {
    return new NextResponse("Missing _ts / _nonce", { status: 400 })
  }
  if (Math.abs(Date.now() - envelope._ts) > REPLAY_WINDOW_MS) {
    return new NextResponse("Stale timestamp", { status: 403 })
  }

  const parsed = publicFormSubmissionSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 422 },
    )
  }
  const data = parsed.data

  const admin = createSupabaseAdminClient()

  // Nonce dedupe via form_submissions.payload->>'_nonce'. We don't have a
  // dedicated nonces table; using the immutable submissions row as the
  // dedupe ledger keeps the audit trail simple.
  const { data: prior } = await admin
    .from("form_submissions")
    .select("id")
    .eq("payload->>_nonce", envelope._nonce)
    .maybeSingle()
  if (prior) {
    return NextResponse.json({ ok: true, replay: true }, { status: 200 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  const userAgent = request.headers.get("user-agent") || null

  const submissionInsert = await admin
    .from("form_submissions")
    .insert({
      form_id: data.form_id,
      name: data.name ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      consent_method: data.consent_method,
      payload: { ...data.payload, _nonce: envelope._nonce, _ts: envelope._ts } as never,
      ip: ip as never,
      user_agent: userAgent,
    })
    .select("id")
    .single()
  if (submissionInsert.error || !submissionInsert.data) {
    return new NextResponse("DB insert failed", { status: 500 })
  }
  const submissionId = submissionInsert.data.id

  const { data: upsertResult, error: upsertErr } = await admin.rpc(
    "upsert_contact_by_phone_or_email" as never,
    {
      p_name: data.name ?? null,
      p_phone: data.phone ?? null,
      p_email: data.email ?? null,
      p_source: "public_form",
      p_consent_method: data.consent_method,
      p_consent_at: new Date().toISOString(),
      p_tags: null,
      p_language: "en",
    } as never,
  )

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  const result = upsertResult as {
    contact_id: string
    needs_review: boolean
    conflict_with: string | null
  } | null

  const contactId = result?.contact_id ?? null
  if (contactId) {
    await admin
      .from("form_submissions")
      .update({ contact_id: contactId })
      .eq("id", submissionId)

    // Secondary opt-in: a checked "send me updates" box is express consent to
    // recurring/marketing messages, separate from the baseline reply consent
    // the upsert already records. Only ever sets consent here — never clears
    // it — so an unchecked box on a later form can't revoke a prior opt-in.
    if (data.marketing_opt_in) {
      await admin
        .from("contacts")
        .update({
          marketing_consent_at: new Date().toISOString(),
          marketing_consent_method: `public_form:${data.form_id}`,
          marketing_opted_out_at: null,
        })
        .eq("id", contactId)
    }
  }

  await logAudit({
    action: "form.submitted",
    targetTable: "form_submissions",
    targetId: submissionId,
    diff: {
      form_id: data.form_id,
      contact_id: contactId,
      needs_review: result?.needs_review ?? false,
      conflict_with: result?.conflict_with ?? null,
      had_phone: Boolean(data.phone),
      had_email: Boolean(data.email),
      marketing_opt_in: data.marketing_opt_in,
    },
    ip,
    userAgent,
  })

  return NextResponse.json(
    {
      ok: true,
      contact_id: contactId,
      needs_review: result?.needs_review ?? false,
    },
    { status: 200 },
  )
}
