import "server-only"
import { z } from "zod"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { createAnthropicClient, isAiEnabled } from "./client"
import { getFeatureConfig, modelSupportsEffort, maxTokensWithThinking, type AiFeatureConfig } from "./config"
import { TAGGING_SYSTEM_PROMPT, SENSITIVE_TAG, BASE_TAG_VOCAB, buildTranscript, type ThreadMessage } from "./prompts"

/** How many recent messages to feed the model. Enough to characterize the
 *  relationship without ballooning token cost on chatty threads. */
const THREAD_LIMIT = 30
/** Cap on the candidate tag list passed in the (cached) system prompt. */
const TAG_VOCAB_LIMIT = 200

/**
 * Structured-output contract. We declare a raw JSON schema to the API (so the
 * model returns this exact shape) and validate the response with the matching
 * Zod schema below — the project pins Zod v3, so we avoid the SDK's v4 zod
 * helper and parse defensively ourselves.
 */
const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    existing_tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags copied verbatim from the provided vocabulary that apply.",
    },
    proposed_tag: {
      type: ["string", "null"],
      description: "One new tag if nothing existing fits, otherwise null.",
    },
    rationale: {
      type: "string",
      description: "One short sentence. No message content quoted.",
    },
  },
  required: ["existing_tags", "proposed_tag", "rationale"],
} as const

const SuggestionSchema = z.object({
  existing_tags: z.array(z.string()).max(5),
  proposed_tag: z.string().nullable(),
  rationale: z.string(),
})

export type TagSuggestion = z.infer<typeof SuggestionSchema>

export type SuggestTagsResult =
  | { ok: true; suggestion: TagSuggestion; currentTags: string[] }
  | {
      ok: false
      reason: "disabled" | "not_found" | "no_context" | "provider_failed"
      detail?: string
    }

/**
 * Ask the model which tags apply, then defensively filter the result against
 * the vocabulary, the contact's current tags, and the SENSITIVE_TAG guard. Pure:
 * the caller supplies the thread (oldest-first), the global vocabulary, the
 * contact's current tags, and the tagging model config. Returns a clean
 * suggestion (existing_tags already excludes current tags), or null on
 * empty-context / parse / provider failure.
 */
export async function proposeTags(
  messages: ThreadMessage[],
  vocab: string[],
  currentTags: string[],
  config: AiFeatureConfig,
  aiTags: string[] = [],
): Promise<TagSuggestion | null> {
  const thread = messages.filter((m) => Boolean(m.body))
  if (thread.length === 0) return null

  // Union the canonical base vocab so source/ministry tags work from day one
  // (no cold-start gap) on top of whatever tags staff have created.
  const vocabList = Array.from(new Set([...BASE_TAG_VOCAB, ...vocab.filter(Boolean)])).sort().slice(0, TAG_VOCAB_LIMIT)
  // Split current tags by provenance so the model treats staff tags as
  // authoritative context (it only ever adds; the app never auto-removes).
  const aiSet = new Set(aiTags)
  const staffTags = currentTags.filter((t) => !aiSet.has(t))
  const autoTags = currentTags.filter((t) => aiSet.has(t))
  const userContent = [
    `Existing tag vocabulary (choose only from these for existing_tags):\n${
      vocabList.length ? vocabList.join(", ") : "(none yet)"
    }`,
    `Tags already on this contact:\n- added by staff (authoritative, do not re-propose): ${staffTags.length ? staffTags.join(", ") : "(none)"}\n- previously auto-applied: ${autoTags.length ? autoTags.join(", ") : "(none)"}`,
    `Recent thread (oldest first):\n${buildTranscript(thread)}`,
  ].join("\n\n")

  try {
    const client = createAnthropicClient()
    const supportsEffort = modelSupportsEffort(config.model)
    const response = await client.messages.create({
      model: config.model,
      // Adaptive thinking so the Settings `effort` genuinely tunes reasoning depth
      // (off on Opus/Sonnet unless enabled); max_tokens reserves thinking headroom
      // so a thinking pass can't truncate the JSON. Haiku: no effort, no thinking.
      max_tokens: maxTokensWithThinking(config.model, config.effort, 512),
      ...(supportsEffort ? { thinking: { type: "adaptive" as const } } : {}),
      system: [{ type: "text", text: TAGGING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: { type: "json_schema", schema: SUGGESTION_JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })

    // A refusal (HTTP 200) or truncation returns non-schema content; treat as no
    // suggestion rather than letting the JSON.parse below throw a cryptic error.
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null
    const raw = response.content
      .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    let parsed: TagSuggestion
    try {
      parsed = SuggestionSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }

    // Defensive: keep only existing tags truly in the vocabulary and not already
    // on the contact; dedupe a proposed tag that collides; drop a proposed tag
    // that encodes a sensitive/private circumstance even if the model returned one.
    const vocabSet = new Set(vocabList)
    const currentSet = new Set(currentTags)
    const existing_tags = Array.from(
      new Set(parsed.existing_tags.filter((t) => vocabSet.has(t) && !currentSet.has(t))),
    )
    let proposed_tag = parsed.proposed_tag?.trim() || null
    if (proposed_tag && (vocabSet.has(proposed_tag) || currentSet.has(proposed_tag))) proposed_tag = null
    if (proposed_tag && SENSITIVE_TAG.test(proposed_tag)) proposed_tag = null

    return { existing_tags, proposed_tag, rationale: parsed.rationale }
  } catch (err) {
    // Do not log message bodies — only the error message.
    console.error("[ai.tagging] provider error:", err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * Suggest tags for a contact from its recent thread and the global tag
 * vocabulary. Read-only: returns suggestions for the operator to confirm in the
 * contact record. The automatic, audited write path lives in organizeInbound;
 * this endpoint-facing helper never mutates.
 */
export async function suggestTags(contactId: string): Promise<SuggestTagsResult> {
  if (!isAiEnabled()) return { ok: false, reason: "disabled" }

  const admin = createSupabaseAdminClient()
  const [config, { data: contact }, { data: thread }, { data: allTagRows }] = await Promise.all([
    getFeatureConfig("tagging"),
    admin.from("contacts").select("id, tags, ai_tags").eq("id", contactId).maybeSingle(),
    admin
      .from("messages")
      .select("direction, body")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT),
    admin.from("contacts").select("tags"),
  ])

  if (!contact) return { ok: false, reason: "not_found" }

  const currentTags = (contact.tags ?? []).filter(Boolean)
  const messages = (thread ?? [])
    .slice()
    .reverse()
    .filter((m): m is { direction: string; body: string } => Boolean(m.body))
  if (messages.length === 0) return { ok: false, reason: "no_context" }

  const vocab: string[] = []
  for (const row of allTagRows ?? []) for (const t of row.tags ?? []) if (t) vocab.push(t)

  const aiTags = ((contact as { ai_tags?: string[] }).ai_tags ?? []).filter(Boolean)
  const suggestion = await proposeTags(messages, vocab, currentTags, config, aiTags)
  if (!suggestion) return { ok: false, reason: "provider_failed" }
  return { ok: true, currentTags, suggestion }
}
