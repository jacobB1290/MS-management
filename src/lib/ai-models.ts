/**
 * Client-safe AI model metadata + validation. Pure data and helpers only — no
 * server imports — so both the Settings picker (a client component) and the
 * server-only call sites can share one source of truth.
 *
 * The DB-backed lookups (`getAiConfig`, `getFeatureConfig`) live in the
 * server-only `@/server/ai/config`, which re-exports everything here.
 */

export type AiFeature = "drafting" | "tagging" | "triage" | "notes" | "optout"
export type AiEffort = "low" | "medium" | "high"
export type AiFeatureConfig = { model: string; effort: AiEffort }
export type AiModelChoice = { id: string; label: string; blurb: string }

/** Models offered in the picker, ordered best/most-expensive first. */
export const AI_MODEL_CHOICES: readonly AiModelChoice[] = [
  { id: "claude-opus-4-7", label: "Opus 4.7", blurb: "Highest quality, highest cost" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", blurb: "Balanced quality and cost" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", blurb: "Fastest and cheapest" },
]

export const AI_EFFORT_CHOICES: readonly { id: AiEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
]

const MODEL_IDS = new Set(AI_MODEL_CHOICES.map((m) => m.id))
const EFFORT_IDS = new Set<AiEffort>(["low", "medium", "high"])

/**
 * Defaults when nothing is stored. Drafting = Sonnet at medium effort (tone
 * quality matters on a one-shot pastoral reply); tagging = Haiku at low effort
 * (cheap, high-volume classification — effort is a no-op on Haiku anyway).
 */
export const AI_DEFAULTS: Record<AiFeature, AiFeatureConfig> = {
  drafting: { model: "claude-sonnet-4-6", effort: "medium" },
  tagging: { model: "claude-haiku-4-5-20251001", effort: "low" },
  triage: { model: "claude-haiku-4-5-20251001", effort: "low" },
  // Background curation. The prompt eval sweep (scripts/ai-eval) ran Haiku vs
  // Sonnet across easy AND hard scenarios. Haiku held up on triage and opt-out
  // (matched Sonnet once the opt-out prompt was hardened), so those stay cheap.
  // Notes goes to Sonnet: on hard cases Haiku dropped an existing fact during a
  // merge and leaked sensitive detail, while Sonnet preserved + minimized
  // cleanly — and notes is the one task where a slip loses data. Any feature is
  // switchable in Settings with no redeploy.
  notes: { model: "claude-sonnet-4-6", effort: "low" },
  optout: { model: "claude-haiku-4-5-20251001", effort: "low" },
}

export const AI_FEATURE_META: Record<AiFeature, { label: string; description: string }> = {
  drafting: {
    label: "Reply drafting",
    description: "Drafts and improves SMS replies in the inbox.",
  },
  tagging: {
    label: "Tag suggestions",
    description: "Suggests contact tags from a conversation.",
  },
  triage: {
    label: "Inbox triage",
    description:
      "Sorts incoming messages into segments (Prayer, Questions, Outreach) and advances their status automatically.",
  },
  notes: {
    label: "Contact notes",
    description: "Keeps each contact's notes updated with durable facts from the conversation.",
  },
  optout: {
    label: "Opt-out detection",
    description: "Catches a plain-language “stop texting me” that the keyword filter misses.",
  },
}

/** Ordered feature list for rendering the pickers. */
export const AI_FEATURES: readonly AiFeature[] = [
  "drafting",
  "tagging",
  "triage",
  "notes",
  "optout",
]

/**
 * Extended thinking / reasoning effort is an Opus + Sonnet capability. Haiku
 * ignores it, so the picker disables the effort control (and the call sites
 * omit the parameter) whenever a Haiku model is selected.
 */
export function modelSupportsEffort(model: string): boolean {
  return model.startsWith("claude-opus") || model.startsWith("claude-sonnet")
}

/** Friendly label for any model id, falling back to the raw id. */
export function modelLabel(model: string): string {
  return AI_MODEL_CHOICES.find((m) => m.id === model)?.label ?? model
}

function coerce(feature: AiFeature, raw: unknown): AiFeatureConfig {
  const def = AI_DEFAULTS[feature]
  if (!raw || typeof raw !== "object") return def
  const r = raw as Record<string, unknown>
  const model = typeof r.model === "string" && MODEL_IDS.has(r.model) ? r.model : def.model
  const effort =
    typeof r.effort === "string" && EFFORT_IDS.has(r.effort as AiEffort)
      ? (r.effort as AiEffort)
      : def.effort
  return { model, effort }
}

/** Normalize an arbitrary stored/posted value into the full typed config. */
export function normalizeConfig(input: unknown): Record<AiFeature, AiFeatureConfig> {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  return {
    drafting: coerce("drafting", r.drafting),
    tagging: coerce("tagging", r.tagging),
    triage: coerce("triage", r.triage),
    notes: coerce("notes", r.notes),
    optout: coerce("optout", r.optout),
  }
}

/** The `app_settings` key under which the config persists. */
export const AI_SETTINGS_KEY = "ai_models"
