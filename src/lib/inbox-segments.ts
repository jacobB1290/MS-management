/**
 * Inbox segments — the single source of truth for the conversation-centric
 * inbox's categories and their per-category status lifecycles. Client-safe
 * (pure data, no server imports) so the conversation list, the thread pane,
 * the classifier, and the segment endpoint all share one definition.
 *
 * Design rules (see the panel decision in the pivot):
 * - A conversation has exactly ONE category, stored on `contacts.inbox_category`.
 *   'general' is the default and the never-hidden catch-all.
 * - "Members" is NOT a category — it's the orthogonal `is_member` overlay. So
 *   the chip row mixes one overlay (members) with the category partition.
 * - Categories partition the inbox: general + prayer + question + outreach
 *   cover every conversation, so their counts sum to the total. Members
 *   overlaps and is shown separately.
 * - Status sets differ per category; 'general' has no managed lifecycle.
 */

export type InboxCategory = "general" | "prayer" | "question" | "outreach"

/** The category partition (excludes the members overlay). */
export const INBOX_CATEGORIES: readonly InboxCategory[] = [
  "general",
  "prayer",
  "question",
  "outreach",
]

export function isInboxCategory(v: unknown): v is InboxCategory {
  return typeof v === "string" && (INBOX_CATEGORIES as readonly string[]).includes(v)
}

/**
 * A segment is what the chip row offers. "all" shows everything (General, the
 * authoritative catch-all); "members" filters the is_member overlay; the rest
 * filter by category. "all" is named "General" in the UI per the owner's
 * vocabulary, but it is unfiltered on purpose — nothing is ever hidden from it.
 */
export const INBOX_SEGMENTS = ["all", "members", "prayer", "question", "outreach"] as const
export type Segment = (typeof INBOX_SEGMENTS)[number]

export const SEGMENT_META: Record<Segment, { label: string }> = {
  all: { label: "General" },
  members: { label: "Members" },
  prayer: { label: "Prayer" },
  question: { label: "Questions" },
  outreach: { label: "Outreach" },
}

/** Labels keyed by the stored category (note 'general', vs the 'all' segment). */
export const CATEGORY_META: Record<InboxCategory, { label: string }> = {
  general: { label: "General" },
  prayer: { label: "Prayer" },
  question: { label: "Questions" },
  outreach: { label: "Outreach" },
}

export type StatusVariant = "gold" | "default" | "success" | "muted"
export interface StatusOption {
  value: string
  label: string
  variant: StatusVariant
  /** Terminal states close out the lifecycle; reaching one is "done". */
  terminal?: boolean
}

/**
 * Per-category status lifecycle. 'general' has none (no management surface).
 * Carried over verbatim from the retired prayer/inquiry modules so the
 * vocabulary staff already know is preserved.
 */
export const CATEGORY_STATUS: Record<InboxCategory, readonly StatusOption[]> = {
  general: [],
  prayer: [
    { value: "new", label: "New", variant: "gold" },
    { value: "praying", label: "Praying", variant: "default" },
    { value: "answered", label: "Answered", variant: "success", terminal: true },
    { value: "archived", label: "Archived", variant: "muted", terminal: true },
  ],
  question: [
    { value: "new", label: "New", variant: "gold" },
    { value: "in_progress", label: "In progress", variant: "default" },
    { value: "closed", label: "Closed", variant: "success", terminal: true },
  ],
  outreach: [
    { value: "new", label: "To reach", variant: "gold" },
    { value: "in_progress", label: "Reaching out", variant: "default" },
    { value: "done", label: "Connected", variant: "success", terminal: true },
  ],
}

/** Whether a category exposes a status lifecycle in the thread. */
export function hasStatusLifecycle(category: InboxCategory): boolean {
  return CATEGORY_STATUS[category].length > 0
}

/** Validate a status value against a category's lifecycle. */
export function isValidStatus(category: InboxCategory, status: string): boolean {
  return CATEGORY_STATUS[category].some((s) => s.value === status)
}

export function statusMeta(
  category: InboxCategory,
  status: string | null,
): StatusOption | null {
  if (!status) return null
  return CATEGORY_STATUS[category].find((s) => s.value === status) ?? null
}
