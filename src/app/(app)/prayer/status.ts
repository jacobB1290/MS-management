/** Shared prayer-request status metadata for badges, filters, and the picker. */
export type PrayerStatus = "new" | "praying" | "answered" | "archived"

export const PRAYER_STATUS_META: Record<
  PrayerStatus,
  { label: string; variant: "gold" | "default" | "success" | "muted" }
> = {
  new: { label: "New", variant: "gold" },
  praying: { label: "Praying", variant: "default" },
  answered: { label: "Answered", variant: "success" },
  archived: { label: "Archived", variant: "muted" },
}

export const PRAYER_STATUS_ORDER: readonly PrayerStatus[] = [
  "new",
  "praying",
  "answered",
  "archived",
]
