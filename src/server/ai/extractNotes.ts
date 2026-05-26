import "server-only"
import { z } from "zod"
import { createAnthropicClient } from "./client"
import { modelSupportsEffort, type AiFeatureConfig } from "./config"
import { NOTES_SYSTEM_PROMPT, buildTranscript, type ThreadMessage } from "./prompts"

/** Matches the contacts.notes column cap; we truncate defensively before write. */
const MAX_NOTES_CHARS = 2000

const NOTES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    notes: {
      type: "string",
      description: "The complete replacement notes text. Empty string if nothing to record.",
    },
  },
  required: ["notes"],
} as const

const NotesSchema = z.object({ notes: z.string() })

/**
 * Maintain the running notes field from the recent thread. Pure: the caller
 * supplies the thread (oldest-first), the current notes, and the notes model
 * config. Returns the new notes text to persist, or null to leave the field
 * unchanged (no new durable facts, no-op rewrite, or a provider/parse failure).
 *
 * Two server-side guards backstop the prompt's "never delete" obligation:
 *   - an empty model result never overwrites existing notes (no silent wipe);
 *   - an unchanged result returns null so we skip a pointless write + audit row.
 */
export async function mergeNotes(
  messages: ThreadMessage[],
  currentNotes: string | null,
  config: AiFeatureConfig,
): Promise<string | null> {
  const thread = messages.filter((m) => Boolean(m.body))
  if (thread.length === 0) return null

  const current = (currentNotes ?? "").trim()
  const userContent = [
    `Current notes:\n${current || "(none yet)"}`,
    `Recent thread (oldest first):\n${buildTranscript(thread)}`,
  ].join("\n\n")

  try {
    const client = createAnthropicClient()
    const supportsEffort = modelSupportsEffort(config.model)
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 700,
      ...(supportsEffort ? { thinking: { type: "disabled" as const } } : {}),
      system: [{ type: "text", text: NOTES_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: {
        format: { type: "json_schema", schema: NOTES_JSON_SCHEMA },
        ...(supportsEffort ? { effort: config.effort } : {}),
      },
    })

    const raw = response.content
      .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    let parsed: z.infer<typeof NotesSchema>
    try {
      parsed = NotesSchema.parse(JSON.parse(raw))
    } catch {
      return null
    }

    const next = parsed.notes.trim().slice(0, MAX_NOTES_CHARS)
    // Never wipe existing notes; never write a no-op.
    if (!next && current) return null
    if (next === current) return null
    return next
  } catch (err) {
    console.error("[ai.notes] provider error:", err instanceof Error ? err.message : String(err))
    return null
  }
}
