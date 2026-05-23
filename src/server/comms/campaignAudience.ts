/**
 * Single source of truth for how a campaign's `audience_filter` maps to a
 * contact selection. v1 supports two shapes:
 *   { all: true }        → every contact
 *   { tags: ["a","b"] }  → contacts whose tags overlap any of these
 * Used by the start route (to stage recipients) and the detail page (to
 * preview the audience size before sending).
 */
export type AudienceMode =
  | { mode: "all" }
  | { mode: "tags"; tags: string[] }
  | { mode: "invalid" }

export function resolveAudienceMode(
  filter: Record<string, unknown> | null | undefined,
): AudienceMode {
  const f = filter ?? {}
  if (Array.isArray(f.tags) && f.tags.length > 0) {
    return { mode: "tags", tags: f.tags as string[] }
  }
  if (f.all === true) {
    return { mode: "all" }
  }
  return { mode: "invalid" }
}
