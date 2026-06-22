import "server-only"
import { z } from "zod"
import { createAnthropicClient } from "./client"
import { modelSupportsEffort, type AiFeatureConfig } from "./config"
import {
  TRIAGE_SYSTEM_PROMPT,
  CRISIS,
  TRIAGE_CONFIDENCE_FLOOR,
  buildTranscript,
  type ThreadMessage,
} from "./prompts"
import {
  INBOX_CATEGORIES,
  CATEGORY_STATUS,
  isInboxCategory,
  isValidStatus,
  type InboxCategory,
} from "@/lib/inbox-segments"

const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: {
      type: "string",
      enum: INBOX_CATEGORIES as unknown as string[],
      description: "The single best segment for the conversation's current need.",
    },
    status: {
      type: ["string", "null"],
      description:
        "The current lifecycle status for the chosen segment, or null for general.",
    },
    confidence: {
      type: "number",
      description: "0 to 1. Certainty about the SEGMENT. Use low values when unsure.",
    },
    rationale: {
      type: "string",
      description: "One short sentence. No message content quoted.",
    },
  },
  required: ["category", "status", "confidence", "rationale"],
} as const

const TriageSchema = z.object({
  category: z.string(),
  status: z.string().nullable(),
  confidence: z.number(),
  rationale: z.string(),
})

export type TriageDecision = {
  category: InboxCategory
  status: string | null
  confidence: number
  crisis: boolean
  /** True when a rule (not the model) decided the outcome. */
  byRule: boolean
}

export type TriageResult =
  | ({ ok: true } & TriageDecision)
  | { ok: false; reason: "no_context" | "provider_failed" }

/** Earliest (entry) status for a category, or null where there is no lifecycle. */
function defaultStatusFor(category: InboxCategory): string | null {
  return CATEGORY_STATUS[category][0]?.value ?? null
}

/**
 * Coerce the model's status into a valid one for the resolved category:
 *   - general has no lifecycle, so status is always null;
 *   - a lifecycle category never stays null/invalid — it falls back to the
 *     entry status so a managed conversation always carries a state (full-auto).
 */
function resolveStatus(category: InboxCategory, status: string | null): string | null {
  if (CATEGORY_STATUS[category].length === 0) return null
  if (status && isValidStatus(category, status)) return status
  return defaultStatusFor(category)
}

/**
 * Classify a conversation into an inbox segment + lifecycle status from its
 * recent thread. Pure: the caller supplies the thread (oldest-first) and the
 * triage model config, and persists the returned decision. The "never hide"
 * safeguards live HERE so there is one wall:
 *   - a crisis keyword forces general (most-watched) without an LLM call;
 *   - model confidence below the floor falls back to general;
 *   - any parse/provider failure returns ok:false so the caller leaves the
 *     existing classification untouched.
 */
export async function classifyConversation(
  messages: ThreadMessage[],
  config: AiFeatureConfig,
): Promise<TriageResult> {
  const thread = messages.filter((m) => Boolean(m.body))
  if (thread.length === 0) return { ok: false, reason: "no_context" }

  // Rules-first crisis floor: the most recent inbound decides. Never hand a
  // crisis to the model to (mis)route — keep it in the always-visible General.
  const lastInbound = [...thread].reverse().find((m) => m.direction === "in")
  if (lastInbound && CRISIS.test(lastInbound.body)) {
    return { ok: true, category: "general", status: null, confidence: 1, crisis: true, byRule: true }
  }

  try {
    const supportsEffort = modelSupportsEffort(config.model)
    const client = createAnthropicClient()
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 256,
      // No `thinking` field: it's off by default on Opus 4.7+/Sonnet 4.6, and
      // {type:"disabled"} 400s on Fable 5. `effort` below is the separate control.
      system: [{ type: "text", text: TRIAGE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Recent thread (oldest first):\n${buildTranscript(thread)}` }],
      output_config: {
        format: { type: "json_schema", schema: TRIAGE_JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })

    const raw = response.content
      .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    let parsed: z.infer<typeof TriageSchema>
    try {
      parsed = TriageSchema.parse(JSON.parse(raw))
    } catch {
      return { ok: false, reason: "provider_failed" }
    }

    const confidence = Math.max(0, Math.min(1, parsed.confidence))
    // Below the floor, or an out-of-range category, falls back to General.
    const category: InboxCategory =
      isInboxCategory(parsed.category) && confidence >= TRIAGE_CONFIDENCE_FLOOR ? parsed.category : "general"

    return {
      ok: true,
      category,
      status: resolveStatus(category, parsed.status),
      confidence,
      crisis: false,
      byRule: false,
    }
  } catch (err) {
    console.error("[ai.triage] provider error:", err instanceof Error ? err.message : String(err))
    return { ok: false, reason: "provider_failed" }
  }
}
