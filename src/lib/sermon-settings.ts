/**
 * Client-safe Sermons (services) settings: the two auto-publish modes. Pure data
 * + validation only — no server imports — so the Settings panel (a client
 * component) and the server-only readers can share one source of truth, exactly
 * like `@/lib/ai-models`.
 *
 * The DB-backed read (`getSermonsConfig`) lives in the server-only
 * `@/server/sermons/config`, which re-exports everything here.
 */

export type SermonSettings = {
  /**
   * Auto-publish runs the operator did NOT kick by hand: the Monday cron, the
   * back-catalog drain, and a Claude-Code-session finalize. On = those land at
   * `published` instead of `review`.
   */
  autoPublishAutomatic: boolean
  /** Auto-publish a manual "Run now". On = a hand-kicked run skips review too. */
  autoPublishManual: boolean
}

/** Which run produced a completed segmentation — drives the auto-publish choice. */
export type RunOrigin = "automatic" | "manual"

/** Nothing stored → both off: existing behavior (everything lands at review). */
export const SERMON_SETTINGS_DEFAULTS: SermonSettings = {
  autoPublishAutomatic: false,
  autoPublishManual: false,
}

/** The `app_settings` key under which the settings persist. */
export const SERMON_SETTINGS_KEY = "sermons"

/**
 * Normalize an arbitrary stored/posted value into the full typed settings.
 * Defensive: a missing or malformed row can never crash a pipeline write — it
 * falls back to the safe defaults (both off), so the worst case is "left in
 * review", never an accidental publish.
 */
export function normalizeSermonSettings(input: unknown): SermonSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  return {
    autoPublishAutomatic: r.autoPublishAutomatic === true,
    autoPublishManual: r.autoPublishManual === true,
  }
}

/**
 * The single rule that turns a completed segmentation's origin + the settings
 * into a landing status. Shared by the API path and the session-finalize path so
 * the two can never disagree.
 */
export function landingStatusFor(origin: RunOrigin, settings: SermonSettings): "published" | "review" {
  if (origin === "automatic" && settings.autoPublishAutomatic) return "published"
  if (origin === "manual" && settings.autoPublishManual) return "published"
  return "review"
}
