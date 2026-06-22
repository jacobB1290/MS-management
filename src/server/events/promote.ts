import "server-only"
import { z } from "zod"
import type Anthropic from "@anthropic-ai/sdk"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import { createAnthropicClient } from "@/server/ai/client"
import { getFeatureConfig, modelSupportsEffort, maxTokensWithThinking } from "@/server/ai/config"
import { eventLongDate, eventDisplayTime } from "@/lib/event-format"

/**
 * "Promote with AI": hand Opus the event flyer (vision) plus the event details
 * and the real audience the church can reach, and get back a complete campaign
 * plan — the promotional message, the optimal audience, and when to send it.
 *
 * The model PROPOSES; the operator reviews and edits the pre-filled composer
 * before anything sends, and the existing consent wall still gates the actual
 * send. Mirrors the structured-output pattern in src/server/ai/triageInbound.ts
 * (json_schema via output_config.format), with the flyer added as image input.
 */

const PUBLIC_EVENTS_URL = "https://ms.church/outreach#events"
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const PROMOTE_SYSTEM_PROMPT = `You are the communications strategist for Morning Star Christian Church in Boise, Idaho. You plan a single promotional campaign (SMS or email) for one church event, working from the event's flyer image and details.

Decide all of the following and return them in the required structure:
- channel: prefer "sms" — the flyer sends as a picture message (MMS) and reaches the most people. Choose "email" only when the event is clearly better suited to a longer, formal note.
- The promotional message. For SMS write the full text (sms_body): warm, plain, and human, as if a friend from church is inviting them. Lead with the event, include the day and time, and end with the link. Keep it under ~300 characters. For email, write a compelling subject line (email_subject). Always also fill the other field with a sensible value.
- audience: pick the optimal targeting. "all" for a broad community event; "members" when it's clearly for the congregation; "tags" with one or more of the provided tag names when the event fits a specific group (e.g. a youth night → a youth tag). Only use tags from the provided vocabulary, and weigh the contact counts — don't pick a tiny tag for a whole-community event.
- timing: pick the best moment to send. Usually a few days to about a week before the event, at a friendly hour (late morning or early evening, never overnight). If the event is very soon, send now. When scheduling, return a future ISO 8601 datetime that is before the event.
- rationale: 2–4 sentences explaining your audience, timing, and message choices for the staff member reviewing this.

Voice: warm, welcoming, community-minded. Use curly apostrophes. Do not use em dashes. Only opted-in, consented contacts actually receive marketing — the system enforces this, so never imply you are reaching everyone.`

const PROMOTE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    channel: { type: "string", enum: ["sms", "email"] },
    campaign_name: {
      type: "string",
      description: "A short internal name for staff (recipients never see it).",
    },
    sms_body: {
      type: "string",
      description: "The promotional SMS text. Include the date/time and the link.",
    },
    email_subject: { type: "string", description: "The email subject line." },
    audience_mode: { type: "string", enum: ["all", "members", "tags"] },
    audience_tags: {
      type: "array",
      items: { type: "string" },
      description: "Chosen tag names from the vocabulary when audience_mode is tags; empty otherwise.",
    },
    send_when: { type: "string", enum: ["now", "scheduled"] },
    scheduled_at: {
      type: "string",
      description: "Future ISO 8601 datetime when send_when is scheduled; empty string when now.",
    },
    rationale: { type: "string" },
  },
  required: [
    "channel",
    "campaign_name",
    "sms_body",
    "email_subject",
    "audience_mode",
    "audience_tags",
    "send_when",
    "scheduled_at",
    "rationale",
  ],
} as const

const ProposalSchema = z.object({
  channel: z.enum(["sms", "email"]),
  campaign_name: z.string(),
  sms_body: z.string(),
  email_subject: z.string(),
  audience_mode: z.enum(["all", "members", "tags"]),
  audience_tags: z.array(z.string()),
  send_when: z.enum(["now", "scheduled"]),
  scheduled_at: z.string(),
  rationale: z.string(),
})

export type PromotionProposal = {
  channel: "sms" | "email"
  name: string
  body: string
  subject: string
  audience: { mode: "all" | "members" | "tags"; tags: string[] }
  scheduledAt: string | null
  rationale: string
}

export type PromoteResult =
  | { ok: true; proposal: PromotionProposal; mock?: boolean }
  | { ok: false; reason: "disabled" | "not_found" | "provider_failed"; detail?: string }

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"

/** Fetch the flyer bytes from its public URL for multimodal input. */
async function fetchFlyer(
  url: string,
): Promise<{ data: string; mediaType: ImageMediaType } | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim()
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
    return { data: Buffer.from(bytes).toString("base64"), mediaType: mime as ImageMediaType }
  } catch {
    return null
  }
}

/** The audiences a campaign can target, summarized for the model. */
async function describeAudience(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<string> {
  const { data } = await admin
    .from("contacts")
    .select(
      "tags, phone, email, is_member, sms_opted_out_at, email_unsubscribed_at, marketing_consent_at, marketing_opted_out_at",
    )
    .limit(5000)
  const rows = data ?? []

  const tagCounts = new Map<string, number>()
  let members = 0
  let smsEligible = 0
  let emailEligible = 0
  for (const c of rows) {
    for (const t of (c.tags ?? []) as string[]) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    if (c.is_member) members += 1
    if (c.phone && !c.sms_opted_out_at && !c.marketing_opted_out_at && c.marketing_consent_at) {
      smsEligible += 1
    }
    if (c.email && !c.email_unsubscribed_at) emailEligible += 1
  }
  const tagLines =
    tagCounts.size > 0
      ? [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([tag, n]) => `  - ${tag} (${n})`)
          .join("\n")
      : "  (no tags yet)"

  return [
    `Total contacts: ${rows.length}`,
    `Members: ${members}`,
    `SMS marketing-eligible (consented, not opted out): ${smsEligible}`,
    `Email-eligible (has email, not unsubscribed): ${emailEligible}`,
    `Tags (name and contact count):`,
    tagLines,
  ].join("\n")
}

export async function proposePromotion(
  eventId: string,
  userId: string,
): Promise<PromoteResult> {
  // Real key required: demo advertises the affordance but has no key, so this
  // returns a clean 503 there (the composer falls back to the static pre-fill).
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "disabled" }

  const admin = createSupabaseAdminClient()
  const { data: event, error } = await admin
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle()
  if (error || !event) return { ok: false, reason: "not_found" }

  const validTags = new Set<string>()
  const audienceText = await describeAudience(admin)
  // Recompute the tag vocabulary set for validating the model's picks.
  {
    const { data } = await admin.from("contacts").select("tags").limit(5000)
    for (const r of data ?? []) for (const t of (r.tags ?? []) as string[]) validTags.add(t)
  }

  const flyer = event.image_public_url ? await fetchFlyer(event.image_public_url) : null
  const time = eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
  const now = new Date()
  const daysUntil = Math.round(
    (new Date(event.starts_at).getTime() - now.getTime()) / 86_400_000,
  )

  const userText = [
    "Event:",
    `- Title: ${event.title}`,
    `- When: ${eventLongDate(event.starts_at)}${time ? ` at ${time}` : ""}${event.all_day ? " (all day)" : ""}`,
    `- Location: ${event.location ?? "not specified"}`,
    ...(event.cost ? [`- Cost: ${event.cost}`] : []),
    ...(event.ages ? [`- Who it's for: ${event.ages}`] : []),
    ...(event.rsvp_by ? [`- RSVP by: ${event.rsvp_by}`] : []),
    `- Description: ${event.description ?? "(none)"}`,
    `- Link to use in the message: ${event.cta_url || PUBLIC_EVENTS_URL}`,
    `- Public events page: ${PUBLIC_EVENTS_URL}`,
    "",
    `Today: ${now.toISOString()} (${daysUntil} day(s) until the event)`,
    "",
    "Audience you can target (a campaign sends to ONE of: everyone, members only, or contacts with chosen tags; opted-out and unconsented contacts are excluded automatically):",
    audienceText,
    "",
    flyer ? "The event flyer is attached above. Plan the promotion." : "No flyer image is available; plan from the details above.",
  ].join("\n")

  const userContent: Anthropic.ContentBlockParam[] = []
  if (flyer) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: flyer.mediaType, data: flyer.data },
    })
  }
  userContent.push({ type: "text", text: userText })

  let parsed: z.infer<typeof ProposalSchema>
  try {
    const config = await getFeatureConfig("promote")
    const supportsEffort = modelSupportsEffort(config.model)
    const client = createAnthropicClient()
    const response = await client.messages.create({
      model: config.model,
      // Adaptive thinking so the Settings `effort` genuinely tunes reasoning depth
      // on this vision + campaign-planning task; max_tokens reserves thinking
      // headroom so a thinking pass can't truncate the JSON. Haiku: no thinking.
      max_tokens: maxTokensWithThinking(config.model, config.effort, 1024),
      ...(supportsEffort ? { thinking: { type: "adaptive" as const } } : {}),
      system: [
        { type: "text", text: PROMOTE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: { type: "json_schema", schema: PROMOTE_JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { ok: false, reason: "provider_failed", detail: `stop_reason:${response.stop_reason}` }
    }
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
    parsed = ProposalSchema.parse(JSON.parse(raw))
  } catch (err) {
    return {
      ok: false,
      reason: "provider_failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  // Keep only tags that actually exist; an empty tag set degrades to "all".
  const chosenTags = parsed.audience_tags.filter((t) => validTags.has(t))
  const mode = parsed.audience_mode === "tags" && chosenTags.length === 0 ? "all" : parsed.audience_mode

  // Accept a schedule only if it parses to a real future instant.
  let scheduledAt: string | null = null
  if (parsed.send_when === "scheduled" && parsed.scheduled_at) {
    const d = new Date(parsed.scheduled_at)
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) scheduledAt = d.toISOString()
  }

  const proposal: PromotionProposal = {
    channel: parsed.channel,
    name: parsed.campaign_name.trim() || `Promote: ${event.title}`,
    body: parsed.sms_body.trim(),
    subject: parsed.email_subject.trim() || event.title,
    audience: { mode, tags: mode === "tags" ? chosenTags : [] },
    scheduledAt,
    rationale: parsed.rationale.trim(),
  }

  await logAudit({
    action: "event.promote",
    actorUserId: userId,
    targetTable: "events",
    targetId: eventId,
    diff: { channel: proposal.channel, audience: proposal.audience, scheduled: scheduledAt },
  })

  return { ok: true, proposal }
}
