import "server-only"
import { z } from "zod"
import { createAnthropicClient } from "./client"
import { modelSupportsEffort, maxTokensWithThinking, type AiFeatureConfig } from "./config"
import {
  OPTOUT_SYSTEM_PROMPT,
  OPTOUT_CONFIDENCE_FLOOR,
  buildTranscript,
  type ThreadMessage,
} from "./prompts"

/**
 * Confidence required before we act on a model-detected opt-out (a positive
 * result suppresses ALL SMS, reversible by staff, so the bar is high). The
 * value is defined in ./prompts beside the other guards; re-exported here so
 * existing callers keep importing it from this module.
 */
export { OPTOUT_CONFIDENCE_FLOOR }

const OPTOUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    opt_out: {
      type: "boolean",
      description: "True only if the contact clearly asked to stop receiving texts.",
    },
    confidence: {
      type: "number",
      description: "0 to 1. Certainty about the opt-out intent. Use low values when unsure.",
    },
    rationale: { type: "string", description: "One short sentence. No message content quoted." },
  },
  required: ["opt_out", "confidence", "rationale"],
} as const

const OptOutSchema = z.object({
  opt_out: z.boolean(),
  confidence: z.number(),
  rationale: z.string(),
})

export type OptOutDecision = { optOut: boolean; confidence: number }

/**
 * Detect a natural-language request to stop being texted — the cases the
 * keyword filter (STOP/CANCEL/...) does not catch. Pure: the caller supplies the
 * thread (oldest-first) and the optout model config, then applies the
 * confidence floor before acting. Returns the raw decision, or null when there
 * is no inbound to judge or the provider/parse fails (treated as "no opt-out").
 */
export async function detectOptOutIntent(
  messages: ThreadMessage[],
  config: AiFeatureConfig,
): Promise<OptOutDecision | null> {
  const thread = messages.filter((m) => Boolean(m.body))
  // Only a contact message can be an opt-out; if the latest turns are all
  // staff, there is nothing new to judge.
  if (!thread.some((m) => m.direction === "in")) return null

  try {
    const client = createAnthropicClient()
    const supportsEffort = modelSupportsEffort(config.model)
    const response = await client.messages.create({
      model: config.model,
      // Adaptive thinking so the Settings `effort` genuinely tunes reasoning depth
      // (off on Opus/Sonnet unless enabled); max_tokens reserves thinking headroom
      // so a thinking pass can't truncate the JSON. Haiku: no effort, no thinking.
      max_tokens: maxTokensWithThinking(config.model, config.effort, 128),
      ...(supportsEffort ? { thinking: { type: "adaptive" as const } } : {}),
      system: [{ type: "text", text: OPTOUT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Recent thread (oldest first):\n${buildTranscript(thread)}` }],
      output_config: {
        format: { type: "json_schema", schema: OPTOUT_JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })

    // High-stakes path: a refusal (HTTP 200) or truncation must never be read as
    // an opt-out. Return null (no opt-out) instead of letting JSON.parse decide.
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null
    const raw = response.content
      .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    let parsed: z.infer<typeof OptOutSchema>
    try {
      parsed = OptOutSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }

    return { optOut: parsed.opt_out, confidence: Math.max(0, Math.min(1, parsed.confidence)) }
  } catch (err) {
    console.error("[ai.optout] provider error:", err instanceof Error ? err.message : String(err))
    return null
  }
}
