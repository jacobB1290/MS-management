import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { modelSupportsEffort, type AiFeatureConfig } from "@/lib/ai-models"

/**
 * Church knowledge lookup for the AI drafting paths. The model decides WHEN to
 * pull facts by calling the `lookup_church_info` tool; this module backs that
 * tool with a full-text search over `church_knowledge` (synced from ms.church +
 * staff-added) and runs the tool-use loop so draftReply/draftEmail stay simple.
 *
 * Reads go through the service-role client (RLS-exempt); the browser never
 * touches this. The knowledge content is church-public info (service times,
 * ministries, beliefs) — no PII.
 */

const LOOKUP_TOOL_NAME = "lookup_church_info"

/** Per-hit body cap handed back to the model, to bound tool-result tokens. */
const MAX_SNIPPET_CHARS = 1500
/** How many entries a single lookup returns. */
const HITS_PER_LOOKUP = 5
/** Tool-call rounds before we force a text answer (so a loop can't run away). */
const MAX_TOOL_ROUNDS = 3

export interface KnowledgeHit {
  title: string
  body: string
  source: string
  source_url: string | null
}

/** Ranked full-text search over the active church knowledge base. */
export async function searchChurchKnowledge(
  query: string,
  limit = HITS_PER_LOOKUP,
): Promise<KnowledgeHit[]> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc("search_church_knowledge", {
    p_query: query ?? "",
    p_limit: limit,
  })
  if (error || !data) return []
  return data.map((r) => ({
    title: r.title,
    body: r.body,
    source: r.source,
    source_url: r.source_url,
  }))
}

/** Render hits as the tool_result text the model reads. */
export function renderKnowledgeForModel(hits: KnowledgeHit[]): string {
  if (hits.length === 0) {
    return "No matching information was found in the church knowledge base. Do not invent details; keep the reply general or offer to follow up."
  }
  return hits
    .map((h) => {
      const body =
        h.body.length > MAX_SNIPPET_CHARS ? `${h.body.slice(0, MAX_SNIPPET_CHARS)}...` : h.body
      const src = h.source_url ? `\nSource: ${h.source_url}` : ""
      return `# ${h.title}${src}\n${body}`
    })
    .join("\n\n")
}

/**
 * The lookup tool the drafting model can call. Byte-stable so it sits inside the
 * cached prompt prefix (tools are serialized before `system`, so the existing
 * cache_control on the system block covers the tools too).
 */
const KNOWLEDGE_TOOLS: Anthropic.Tool[] = [
  {
    name: LOOKUP_TOOL_NAME,
    description:
      "Look up factual information about Morning Star Christian Church from the church's own knowledge base (synced from the church website and maintained by staff): worship and service times, Bible studies and small groups, youth and kids ministry, outreach, events, location and directions, beliefs, and how to visit, get baptized, or join. Call this whenever the person asks about the church or you need a specific fact (a time, day, place, address, or ministry detail) to reply accurately. Never guess these facts; look them up. You may call it more than once with different queries. If it returns nothing relevant, keep the reply general or offer to follow up rather than inventing details.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A few words naming what to look up, e.g. 'bible study times', 'sunday service', 'youth group', 'location address', 'how to get baptized'.",
        },
      },
      required: ["query"],
    },
  },
]

/**
 * Run a one-shot drafting generation that may call `lookup_church_info` to pull
 * church facts. Returns the model's final concatenated text (the caller does its
 * own post-processing: plain-text cleanup for SMS, JSON parse for email).
 *
 * Caching: callers pass their byte-stable `system` block with cache_control;
 * the stable tool definitions ride in the same cached prefix.
 */
export async function generateWithKnowledge(args: {
  client: Anthropic
  config: AiFeatureConfig
  maxTokens: number
  system: Anthropic.TextBlockParam[]
  userContent: string
}): Promise<string> {
  const { client, config, maxTokens, system, userContent } = args
  // Effort/extended-thinking applies only to Opus + Sonnet; Haiku rejects the
  // params. Thinking stays disabled — a pastoral reply needs no reasoning trace.
  const tuning = modelSupportsEffort(config.model)
    ? { thinking: { type: "disabled" as const }, output_config: { effort: config.effort } }
    : {}

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }]

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the final round, withdraw the tool so the model must produce an answer.
    const forceAnswer = round === MAX_TOOL_ROUNDS
    const response = await client.messages.create({
      model: config.model,
      max_tokens: maxTokens,
      ...tuning,
      system,
      tools: KNOWLEDGE_TOOLS,
      ...(forceAnswer ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    })

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    )
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return textOf(response.content)
    }

    // Echo the assistant turn (incl. the tool_use blocks), then answer each.
    messages.push({ role: "assistant", content: response.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const query =
        tu.name === LOOKUP_TOOL_NAME && isQueryInput(tu.input) ? tu.input.query : ""
      const hits = await searchChurchKnowledge(query)
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: renderKnowledgeForModel(hits),
      })
    }
    messages.push({ role: "user", content: toolResults })
  }

  return ""
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
}

function isQueryInput(input: unknown): input is { query: string } {
  return Boolean(input) && typeof (input as { query?: unknown }).query === "string"
}
