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
export type AiModelClass = "opus" | "sonnet" | "haiku"
export type AiFeatureConfig = { model: string; effort: AiEffort }
export type AiModelChoice = { id: string; label: string; blurb: string }

/**
 * One entry per model class — the picker offers a class, not a pinned version.
 * To adopt a new release, bump ONLY the `latest` id here: the picker then shows
 * just that version, and every stored config + default auto-upgrades on the next
 * read, because resolution maps any pinned id of the same class to this `latest`
 * (see `resolveModel`). So when Opus 4.7 supersedes 4.6, a contact whose config
 * still says `claude-opus-4-6` is silently served `claude-opus-4-7` — no
 * migration, no redeploy of the call sites. Ordered best/most-expensive first.
 */
export const AI_MODEL_FAMILIES: Record<AiModelClass, { latest: string; blurb: string }> = {
  opus: { latest: "claude-opus-4-7", blurb: "Highest quality, highest cost" },
  sonnet: { latest: "claude-sonnet-4-6", blurb: "Balanced quality and cost" },
  haiku: { latest: "claude-haiku-4-5-20251001", blurb: "Fastest and cheapest" },
}

const MODEL_CLASS_ORDER: readonly AiModelClass[] = ["opus", "sonnet", "haiku"]

/** Map any Claude model id to its class by family prefix; null if unrecognized. */
export function modelClass(model: string): AiModelClass | null {
  if (model.startsWith("claude-opus")) return "opus"
  if (model.startsWith("claude-sonnet")) return "sonnet"
  if (model.startsWith("claude-haiku")) return "haiku"
  return null
}

/**
 * Forward-resolve any model id to the current latest of its class. A config
 * pinned to an older version (e.g. `claude-opus-4-6`) resolves to the latest
 * (`claude-opus-4-7`); an unrecognized id returns null so callers fall back to a
 * default. This is the single mechanism behind "always run the newest version".
 */
export function resolveModel(model: string): string | null {
  const cls = modelClass(model)
  return cls ? AI_MODEL_FAMILIES[cls].latest : null
}

/** Derive a friendly version label ("Opus 4.7") from a model id. */
function deriveModelLabel(model: string): string {
  const m = model.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/)
  if (!m) return model
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`
}

/** Models offered in the picker — exactly one (the latest) per class. */
export const AI_MODEL_CHOICES: readonly AiModelChoice[] = MODEL_CLASS_ORDER.map((cls) => ({
  id: AI_MODEL_FAMILIES[cls].latest,
  label: deriveModelLabel(AI_MODEL_FAMILIES[cls].latest),
  blurb: AI_MODEL_FAMILIES[cls].blurb,
}))

export const AI_EFFORT_CHOICES: readonly { id: AiEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
]

const EFFORT_IDS = new Set<AiEffort>(["low", "medium", "high"])

/**
 * Defaults when nothing is stored. Drafting = Sonnet at medium effort (tone
 * quality matters on a one-shot pastoral reply); tagging = Haiku at low effort
 * (cheap, high-volume classification — effort is a no-op on Haiku anyway).
 */
export const AI_DEFAULTS: Record<AiFeature, AiFeatureConfig> = {
  drafting: { model: AI_MODEL_FAMILIES.sonnet.latest, effort: "medium" },
  tagging: { model: AI_MODEL_FAMILIES.haiku.latest, effort: "low" },
  triage: { model: AI_MODEL_FAMILIES.haiku.latest, effort: "low" },
  // Background curation. The prompt eval sweep (scripts/ai-eval) ran Haiku vs
  // Sonnet across easy AND hard scenarios. Haiku held up on triage and opt-out
  // (matched Sonnet once the opt-out prompt was hardened), so those stay cheap.
  // Notes goes to Sonnet: on hard cases Haiku dropped an existing fact during a
  // merge and leaked sensitive detail, while Sonnet preserved + minimized
  // cleanly — and notes is the one task where a slip loses data. Any feature is
  // switchable in Settings with no redeploy.
  notes: { model: AI_MODEL_FAMILIES.sonnet.latest, effort: "low" },
  optout: { model: AI_MODEL_FAMILIES.haiku.latest, effort: "low" },
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
  return deriveModelLabel(model)
}

function coerce(feature: AiFeature, raw: unknown): AiFeatureConfig {
  const def = AI_DEFAULTS[feature]
  if (!raw || typeof raw !== "object") return def
  const r = raw as Record<string, unknown>
  // Forward-resolve to the latest of the stored model's class, so a config left
  // on a superseded version follows the family upgrade automatically.
  const model = (typeof r.model === "string" ? resolveModel(r.model) : null) ?? def.model
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
