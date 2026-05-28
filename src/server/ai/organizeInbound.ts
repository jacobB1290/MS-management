import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { isAiEnabled } from "./client"
import { getAiConfig } from "./config"
import { classifyConversation } from "./triageInbound"
import { proposeTags } from "./suggestTags"
import { mergeNotes } from "./extractNotes"
import { detectOptOutIntent, OPTOUT_CONFIDENCE_FLOOR } from "./detectOptOut"
import type { ThreadMessage } from "./prompts"

/** Recent depth fed to every task. Tagging wants the most context; the rest read
 *  fewer turns but a shared, bounded fetch keeps the inbound path to one query. */
const THREAD_LIMIT = 30

/**
 * The background "organize" pipeline. After a genuinely new inbound is stored,
 * this sorts and curates the conversation with no operator action:
 *   - opt-out: a natural-language "stop texting me" the keyword filter missed;
 *   - triage: the inbox segment + its lifecycle status (full-auto);
 *   - tags: additive ministry-interest tags;
 *   - notes: a running memory of durable facts.
 *
 * Every step is independent and best-effort: it reads the same thread, writes
 * only its own column(s), audits its own change, and can never throw or fail the
 * webhook. AI off (or no key) → the whole thing is a no-op.
 */
export async function organizeConversation(
  contactId: string,
  opts: { source: string; messageSid?: string; channel?: "sms" | "email" } = { source: "inbound" },
): Promise<void> {
  if (!isAiEnabled()) return

  try {
    const admin = createSupabaseAdminClient()
    const [{ data: contact }, { data: threadRows }, { data: allTagRows }, config] = await Promise.all([
      admin
        .from("contacts")
        .select("id, tags, ai_tags, notes, inbox_category, inbox_status, sms_opted_out_at, email_unsubscribed_at")
        .eq("id", contactId)
        .maybeSingle(),
      admin
        .from("messages")
        .select("direction, body, created_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(THREAD_LIMIT),
      admin.from("contacts").select("tags"),
      getAiConfig(),
    ])

    if (!contact) return

    const messages: ThreadMessage[] = (threadRows ?? [])
      .slice()
      .reverse()
      .filter((m): m is { direction: string; body: string; created_at: string } => Boolean(m.body))
      .map((m) => ({ direction: m.direction, body: m.body }))

    if (messages.length === 0) return

    const currentTags = (contact.tags ?? []).filter(Boolean)
    const currentAiTags = ((contact as { ai_tags?: string[] }).ai_tags ?? []).filter(Boolean)
    const vocab: string[] = []
    for (const row of allTagRows ?? []) for (const t of row.tags ?? []) if (t) vocab.push(t)

    // Run the four model tasks concurrently; each is wrapped so one provider
    // hiccup can't sink the others.
    const [optOut, triage, tagSuggestion, nextNotes] = await Promise.all([
      detectOptOutIntent(messages, config.optout).catch(() => null),
      classifyConversation(messages, config.triage).catch(() => null),
      proposeTags(messages, vocab, currentTags, config.tagging, currentAiTags).catch(() => null),
      mergeNotes(messages, contact.notes, config.notes).catch(() => null),
    ])

    const nowIso = new Date().toISOString()

    // --- Opt-out: natural-language stop the keyword filter missed. ----------
    // Mirrors the manual button + carrier STOP / email unsubscribe. The opt-out
    // is applied to the SAME channel the message arrived on: an email reply of
    // "stop emailing me" must unsubscribe email, not block SMS. Only fires above
    // the confidence floor and only when not already opted out on that channel.
    const onEmail = opts.channel === "email"
    const alreadyOut = onEmail
      ? Boolean((contact as { email_unsubscribed_at?: string | null }).email_unsubscribed_at)
      : Boolean(contact.sms_opted_out_at)
    if (optOut?.optOut && optOut.confidence >= OPTOUT_CONFIDENCE_FLOOR && !alreadyOut) {
      try {
        if (onEmail) {
          await admin
            .from("contacts")
            .update({ email_unsubscribed_at: nowIso })
            .eq("id", contactId)
            .is("email_unsubscribed_at", null)
        } else {
          await admin
            .from("contacts")
            .update({ sms_opted_out_at: nowIso })
            .eq("id", contactId)
            .is("sms_opted_out_at", null)
        }
        await logAudit({
          action: onEmail ? "contact.unsubscribe_email" : "contact.opt_out_sms",
          targetTable: "contacts",
          targetId: contactId,
          diff: {
            source: "inbound_soft_optout",
            channel: opts.channel ?? "sms",
            confidence: optOut.confidence,
            message_sid: opts.messageSid,
          },
        })
      } catch {
        /* best-effort */
      }
    }

    // --- Triage: segment + lifecycle status (full-auto). --------------------
    if (triage?.ok) {
      const curCat = contact.inbox_category ?? "general"
      const curStatus = contact.inbox_status ?? null
      if (triage.category !== curCat || triage.status !== curStatus) {
        try {
          await admin
            .from("contacts")
            .update({
              inbox_category: triage.category,
              ...(triage.category !== curCat ? { inbox_category_at: nowIso } : {}),
              inbox_status: triage.status,
              ...(triage.status !== curStatus ? { inbox_status_at: nowIso } : {}),
            })
            .eq("id", contactId)
          await logAudit({
            action: "contact.inbox_triage",
            targetTable: "contacts",
            targetId: contactId,
            diff: {
              category: triage.category,
              status: triage.status,
              confidence: triage.confidence,
              crisis: triage.crisis,
              by_rule: triage.byRule,
              source: opts.source,
              message_sid: opts.messageSid,
            },
          })
        } catch {
          /* best-effort */
        }
      }
    }

    // --- Tags: additive only; never removes an existing tag. ----------------
    if (tagSuggestion) {
      const additions = [
        ...tagSuggestion.existing_tags,
        ...(tagSuggestion.proposed_tag ? [tagSuggestion.proposed_tag] : []),
      ]
      const merged = Array.from(new Set([...currentTags, ...additions]))
      if (merged.length > currentTags.length) {
        // Provenance: everything newly added here is AI-applied (no human in the
        // loop). Carry forward prior ai_tags that survive; staff tags stay out.
        const added = merged.filter((t) => !currentTags.includes(t))
        const aiTagsNext = Array.from(new Set([...currentAiTags.filter((t) => merged.includes(t)), ...added]))
        try {
          await admin.from("contacts").update({ tags: merged, ai_tags: aiTagsNext }).eq("id", contactId)
          await logAudit({
            action: "contact.auto_tag",
            targetTable: "contacts",
            targetId: contactId,
            diff: {
              added,
              source: opts.source,
              message_sid: opts.messageSid,
            },
          })
        } catch {
          /* best-effort */
        }
      }
    }

    // --- Notes: merged running memory (never wipes existing). ----------------
    if (nextNotes !== null) {
      try {
        await admin.from("contacts").update({ notes: nextNotes }).eq("id", contactId)
        await logAudit({
          action: "contact.auto_note",
          targetTable: "contacts",
          targetId: contactId,
          diff: { before: contact.notes, after: nextNotes, source: opts.source, message_sid: opts.messageSid },
        })
      } catch {
        /* best-effort */
      }
    }
  } catch (err) {
    // The entire pipeline is best-effort; never let it break the inbound path.
    console.error("[ai.organize] error:", err instanceof Error ? err.message : String(err))
  }
}
