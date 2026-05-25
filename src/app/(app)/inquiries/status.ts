/** Shared inquiry status metadata for badges, filters, and the picker. */
export type InquiryStatus = "new" | "in_progress" | "closed"

export const INQUIRY_STATUS_META: Record<
  InquiryStatus,
  { label: string; variant: "gold" | "default" | "success" | "muted" }
> = {
  new: { label: "New", variant: "gold" },
  in_progress: { label: "In progress", variant: "default" },
  closed: { label: "Closed", variant: "success" },
}

export const INQUIRY_STATUS_ORDER: readonly InquiryStatus[] = ["new", "in_progress", "closed"]
