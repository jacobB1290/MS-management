/**
 * Client-safe AI model metadata + validation. Pure data and helpers only — no
 * server imports — so both the Settings picker (a client component) and the
 * server-only call sites can share one source of truth.
 *
 * The DB-backed lookups (`getAiConfig`, `getFeatureConfig`) live in the
 * server-only `@/server/ai/config`, which re-exports everything here.
 */

export type AiFeature = "drafting" | "tagging" | "triage" | "notes" | "optout" | "promote"
/**
 * Reasoning-effort tiers, lowest → highest. `xhigh` sits between `high` and
 * `max` (it is NOT an alias for high). Not every model accepts every tier —
 * see `effortLevelsForModel` for the per-model support matrix.
 */
export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max"
export type AiModelClass = "opus" | "sonnet" | "haiku" | "fable"
export type AiFeatureConfig = { model: string; effort: AiEffort }
export type AiModelChoice = { id: string; label: string; blurb: string }
/** The latest id (+ display blurb) for each model class. */
export type AiModelFamilies = Record<AiModelClass, { latest: string; blurb: string }>

/**
 * FALLBACK families, used only when live discovery is unavailable (no
 * `ANTHROPIC_API_KEY`, demo mode, or the Models API is unreachable). The real
 * source of truth is `getModelFamilies()` in `@/server/ai/models`, which queries
 * the Anthropic Models API at runtime and picks the newest version per class —
 * so a new release (e.g. Opus 4.8) is adopted automatically with no code change.
 * These values only matter offline; keep them reasonable, not necessarily current.
 * Ordered best/most-expensive first.
 */
/**
 * ┌─ PASTE-IN (one value) ────────────────────────────────────────────────┐
 * │ The published fable model id. This is the ONLY thing left to fill in.   │
 * │ It ships as a placeholder; replace the placeholder string with the real │
 * │ id and the whole class lights up — picker option, "Fable x.y" label,    │
 * │ effort tiers, and forward-resolution. With an ANTHROPIC_API_KEY set,     │
 * │ live Models API discovery adopts the same id automatically, so this      │
 * │ value only governs offline/demo. Until set, the placeholder is inert: it │
 * │ does not parse, so it is filtered out of the picker.                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
const FABLE_MODEL_ID = "PASTE_FABLE_MODEL_ID_HERE"
/** Class prefix = the id minus its trailing `-<version…>`. Derived, not hardcoded. */
const FABLE_PREFIX = FABLE_MODEL_ID.replace(/-\d.*$/, "")

export const AI_MODEL_FAMILIES: AiModelFamilies = {
  fable: { latest: FABLE_MODEL_ID, blurb: "Newest flagship" },
  opus: { latest: "claude-opus-4-8", blurb: "Highest quality, highest cost" },
  sonnet: { latest: "claude-sonnet-4-6", blurb: "Balanced quality and cost" },
  haiku: { latest: "claude-haiku-4-5", blurb: "Fastest and cheapest" },
}

export const MODEL_CLASS_ORDER: readonly AiModelClass[] = ["fable", "opus", "sonnet", "haiku"]

/** Map any Claude model id to its class by family prefix; null if unrecognized. */
export function modelClass(model: string): AiModelClass | null {
  // Guard on FABLE_PREFIX so the unset placeholder ("…HERE") never matches.
  if (FABLE_PREFIX && model.startsWith(FABLE_PREFIX)) return "fable"
  if (model.startsWith("claude-opus")) return "opus"
  if (model.startsWith("claude-sonnet")) return "sonnet"
  if (model.startsWith("claude-haiku")) return "haiku"
  return null
}

/**
 * Forward-resolve any model id to the current latest of its class, given a
 * families map. A config pinned to an older version (e.g. `claude-opus-4-6`)
 * resolves to whatever that map says is latest (`claude-opus-4-8` once the live
 * Models API reports it); an unrecognized id returns null so callers fall back
 * to a default. This is the single mechanism behind "always run the newest".
 */
export function resolveModelIn(model: string, families: AiModelFamilies): string | null {
  const cls = modelClass(model)
  return cls ? families[cls].latest : null
}

/** Resolve against the offline FALLBACK families (client-safe, no network). */
export function resolveModel(model: string): string | null {
  return resolveModelIn(model, AI_MODEL_FAMILIES)
}

/**
 * Parse a Claude model id into its class + version. Model ids come in a few
 * shapes — `claude-opus-4-8` (alias), `claude-haiku-4-5-20251001` (dated), and
 * the older `claude-opus-4-20250514` where the version is just the major and the
 * trailing 8-digit block is a release DATE, not a minor version. A numeric
 * segment of 6+ digits is treated as the date; the rest are version parts. This
 * is what lets ranking pick 4.8 over the deprecated 4.0 dated id.
 */
export function parseModelVersion(
  model: string,
): { cls: AiModelClass; major: number; minor: number; date: number } | null {
  const m = model.match(/^claude-(opus|sonnet|haiku|fable)-(.+)$/)
  if (!m) return null
  const segs = m[2].split("-").filter((s) => /^\d+$/.test(s))
  if (segs.length === 0) return null
  let date = 0
  let version = segs
  if (segs[segs.length - 1].length >= 6) {
    date = Number(segs[segs.length - 1])
    version = segs.slice(0, -1)
  }
  return {
    cls: m[1] as AiModelClass,
    major: Number(version[0] ?? 0),
    minor: Number(version[1] ?? 0),
    date,
  }
}

/** Derive a friendly version label ("Opus 4.8") from a model id. */
export function deriveModelLabel(model: string): string {
  const v = parseModelVersion(model)
  if (!v) return model
  return `${v.cls[0].toUpperCase()}${v.cls.slice(1)} ${v.major}.${v.minor}`
}

/** One picker option (the latest) per class, from a families map. */
export function modelChoicesFrom(families: AiModelFamilies): AiModelChoice[] {
  return MODEL_CLASS_ORDER
    // Skip a class whose id doesn't parse — e.g. the unset fable placeholder —
    // so it never renders as a junk option (it appears the moment a real id is set).
    .filter((cls) => parseModelVersion(families[cls].latest) !== null)
    .map((cls) => ({
      id: families[cls].latest,
      label: deriveModelLabel(families[cls].latest),
      blurb: families[cls].blurb,
    }))
}

/** Picker options from the offline FALLBACK families. */
export const AI_MODEL_CHOICES: readonly AiModelChoice[] = modelChoicesFrom(AI_MODEL_FAMILIES)

/** All five tiers, ascending. The picker filters this per selected model. */
export const AI_EFFORT_CHOICES: readonly { id: AiEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
  { id: "max", label: "Max" },
]

/** Canonical low→high ordering, used for clamping a stored tier to a model. */
export const EFFORT_ORDER: readonly AiEffort[] = ["low", "medium", "high", "xhigh", "max"]

const EFFORT_IDS = new Set<AiEffort>(EFFORT_ORDER)

/** major.minor >= m.n */
function versionAtLeast(major: number, minor: number, m: number, n: number): boolean {
  return major > m || (major === m && minor >= n)
}

/**
 * The reasoning-effort tiers a given model accepts, ascending. Empty = the
 * model has no effort control (the call sites then omit the parameter; sending
 * it would 400). The matrix mirrors Anthropic's effort support:
 *   - low / medium / high : Opus 4.5+ and Sonnet 4.6+ (NOT Sonnet 4.5, NOT Haiku)
 *   - max                 : Opus 4.6 and later only (never Sonnet or Haiku)
 *   - xhigh               : Opus 4.7 and later only (between high and max)
 * Parsed from the model id, so a future Opus 4.9 inherits the full set without
 * a code change, matching how the model families auto-update.
 */
export function effortLevelsForModel(model: string): AiEffort[] {
  const v = parseModelVersion(model)
  if (!v) return []
  const { cls, major, minor } = v
  // fable: flagship — ASSUMED to support the full effort range. Verify against
  // the model's real support and trim this one line if it caps lower.
  if (cls === "fable") return ["low", "medium", "high", "xhigh", "max"]
  if (cls === "haiku") return []
  if (cls === "sonnet") {
    return versionAtLeast(major, minor, 4, 6) ? ["low", "medium", "high"] : []
  }
  // Opus: effort starts at 4.5; max at 4.6; xhigh at 4.7.
  if (cls === "opus") {
    if (!versionAtLeast(major, minor, 4, 5)) return []
    const tiers: AiEffort[] = ["low", "medium", "high"]
    if (versionAtLeast(major, minor, 4, 7)) tiers.push("xhigh")
    if (versionAtLeast(major, minor, 4, 6)) tiers.push("max")
    return tiers
  }
  return []
}

/**
 * Clamp a stored effort to one the model actually supports: keep it if valid,
 * otherwise drop to the highest supported tier at or below it. This is the wall
 * that stops a config left on `max` from 400ing after its model is switched to
 * Sonnet (high-max) or to an Opus version without `xhigh`.
 */
export function clampEffort(model: string, effort: AiEffort): AiEffort {
  const levels = effortLevelsForModel(model)
  if (levels.length === 0) return effort // unused: call sites omit effort here
  if (levels.includes(effort)) return effort
  const wantIdx = EFFORT_ORDER.indexOf(effort)
  let best = levels[0]
  for (const l of levels) {
    if (EFFORT_ORDER.indexOf(l) <= wantIdx) best = l // levels ascending → largest ≤ want
  }
  return best
}

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
  // Event promotion reads the flyer (vision) and plans the whole campaign —
  // message, audience, timing. The most capable model at high effort; it runs
  // once per "Promote", not in a hot loop, so cost isn't the constraint.
  promote: { model: AI_MODEL_FAMILIES.opus.latest, effort: "high" },
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
  promote: {
    label: "Event promotion",
    description:
      "Reads an event’s flyer and drafts the whole promo campaign — message, the best audience, and when to send it.",
  },
}

/** Ordered feature list for rendering the pickers. */
export const AI_FEATURES: readonly AiFeature[] = [
  "drafting",
  "tagging",
  "triage",
  "notes",
  "optout",
  "promote",
]

/**
 * Whether the model accepts the effort parameter at all. Derived from the
 * per-tier matrix so it stays in lockstep with `effortLevelsForModel` — Haiku
 * (and the pre-effort Opus/Sonnet versions) report false, so the picker
 * disables the control and the call sites omit the parameter.
 */
export function modelSupportsEffort(model: string): boolean {
  return effortLevelsForModel(model).length > 0
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
  const rawEffort =
    typeof r.effort === "string" && EFFORT_IDS.has(r.effort as AiEffort)
      ? (r.effort as AiEffort)
      : def.effort
  // Clamp to what the (offline-resolved) model supports; getAiConfig re-clamps
  // against the live-latest model, so a stored tier the model can't take never
  // reaches the provider.
  const effort = clampEffort(model, rawEffort)
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
    promote: coerce("promote", r.promote),
  }
}

/** The `app_settings` key under which the config persists. */
export const AI_SETTINGS_KEY = "ai_models"
