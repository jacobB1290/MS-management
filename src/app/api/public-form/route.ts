import { NextResponse, type NextRequest } from "next/server"
import { verifyHmacRequest } from "@/server/webhooks/verify"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { publicFormSubmissionSchema } from "@/server/validation/schemas"
import { logAudit } from "@/server/audit"
import { sendPushToStaff } from "@/server/push/send"
import { classifyInbound } from "@/server/ai/triageInbound"
import { formatPhone } from "@/lib/utils"

const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Public website form receiver. The website POSTs JSON signed with
 * PUBLIC_FORM_HMAC_SECRET; the JSON body must include `_ts` (unix ms) and
 * `_nonce` so we can refuse replays. Behavior:
 *   1. Verify HMAC.
 *   2. Reject if `_ts` is more than 5 minutes off (clock skew window).
 *   3. Reject if `_nonce` has been seen (idempotency / replay ledger).
 *   4. Insert form_submissions (immutable audit row).
 *   5. Atomic contact upsert via the SQL RPC.
 *   6. Record express marketing consent when the opt-in box was checked.
 *   7. Seed the contact's inbox thread with the message they typed, so the
 *      submission lands as a real conversation staff can reply to (and so the
 *      inbound opens the conversational-consent reply window). Then triage it
 *      into a segment and push-notify staff, mirroring the SMS inbound webhook.
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

  // Field-location tolerance. The website nests the typed message and the
  // opt-in flags inside `payload` rather than sending them top-level, so accept
  // either shape and let an explicit top-level value win. Without this the
  // message never seeds a thread and a checked opt-in box is silently dropped.
  const payloadObj = data.payload as Record<string, unknown>
  const resolvedMessage: string | null =
    data.message ??
    (typeof payloadObj.message === "string" && payloadObj.message.trim().length > 0
      ? payloadObj.message.trim().slice(0, 1600)
      : null)
  const marketingOptIn =
    data.marketing_opt_in === true ||
    payloadObj.marketing_opt_in === true ||
    payloadObj.updates_opt_in === true

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
  let messageId: string | null = null

  if (contactId) {
    await admin
      .from("form_submissions")
      .update({ contact_id: contactId })
      .eq("id", submissionId)

    // Secondary opt-in: a checked "send me updates" box is express consent to
    // recurring/marketing messages, separate from the baseline reply consent
    // the upsert already records. Only ever sets consent here — never clears
    // it — so an unchecked box on a later form can't revoke a prior opt-in.
    if (marketingOptIn) {
      await admin
        .from("contacts")
        .update({
          marketing_consent_at: new Date().toISOString(),
          marketing_consent_method: `public_form:${data.form_id}`,
          marketing_opted_out_at: null,
        })
        .eq("id", contactId)
    }

    // Seed the inbox thread. The message the person typed becomes the first
    // inbound in their conversation, so the submission surfaces in the inbox
    // (which only lists contacts that have a message) and — being an inbound —
    // opens the conversational-consent window so staff can reply right away.
    // channel 'form' keeps the provenance honest (it did NOT arrive over SMS).
    if (resolvedMessage) {
      const { data: inserted } = await admin
        .from("messages")
        .insert({
          contact_id: contactId,
          direction: "in",
          body: resolvedMessage,
          channel: "form",
          status: "received",
          context: "transactional_event",
        })
        .select("id")
        .maybeSingle()
      messageId = inserted?.id ?? null

      // Best-effort follow-ups, exactly as the SMS inbound webhook does. A
      // failure here must never fail the submission — the contact, consent,
      // and message are already persisted.
      if (messageId) {
        const { data: c } = await admin
          .from("contacts")
          .select("name, phone, inbox_category, inbox_status")
          .eq("id", contactId)
          .maybeSingle()

        try {
          const title = c?.name || formatPhone(c?.phone ?? null) || "New form submission"
          await sendPushToStaff({
            title,
            body: resolvedMessage.slice(0, 140),
            url: `/inbox?c=${contactId}`,
            tag: `contact-${contactId}`,
          })
        } catch {
          /* swallow — delivery is best-effort */
        }

        // Sort into a segment. Non-destructive: only ever moves the
        // conversation between segments, never hides it from General. Skipped
        // when staff have already actioned the thread (inbox_status set). AI
        // off → no-op, stays in General.
        if (c && c.inbox_status == null) {
          try {
            const triage = await classifyInbound(contactId)
            if (triage.ok && triage.category !== (c.inbox_category ?? "general")) {
              await admin
                .from("contacts")
                .update({
                  inbox_category: triage.category,
                  inbox_category_at: new Date().toISOString(),
                })
                .eq("id", contactId)
                .is("inbox_status", null)
              await logAudit({
                action: "contact.inbox_triage",
                targetTable: "contacts",
                targetId: contactId,
                diff: {
                  category: triage.category,
                  confidence: triage.confidence,
                  crisis: triage.crisis,
                  by_rule: triage.byRule,
                  source: "public_form",
                  form_id: data.form_id,
                },
              })
            }
          } catch {
            /* swallow — triage is best-effort */
          }
        }
      }
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
      marketing_opt_in: marketingOptIn,
      seeded_message: Boolean(messageId),
    },
    ip,
    userAgent,
  })

  return NextResponse.json(
    {
      ok: true,
      contact_id: contactId,
      needs_review: result?.needs_review ?? false,
      message_id: messageId,
    },
    { status: 200 },
  )
}
