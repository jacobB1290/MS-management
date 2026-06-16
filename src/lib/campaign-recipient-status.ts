import { explainTwilioError } from "./twilio-errors"

/** Mirrors the `Badge` variants in components/ui/badge.tsx. */
export type OutcomeVariant = "default" | "success" | "warning" | "danger" | "gold" | "muted"

/** Coarse bucket for the funnel bar + filter grouping. */
export type OutcomeGroup = "delivered" | "inflight" | "skipped" | "failed"

export interface RecipientOutcome {
  group: OutcomeGroup
  /** Pill label — also the filter-chip identity. Chrome voice: no trailing period. */
  label: string
  /** One plain sentence: what happened to this person and why. */
  detail: string
  variant: OutcomeVariant
}

/**
 * Translate one `campaign_recipients` row into the human "who + why" the operator
 * needs — the answer the old counts-only page could never give. The skip reasons
 * mirror `classifyRecipient`; a `failed` SMS reuses `explainTwilioError` so it
 * reads exactly like the inbox failed-message bubble. For SMS, the carrier-
 * confirmed `messages` status/error (set by the delivery webhook) is the truth
 * and overrides the recipient's "sent".
 */
export function recipientOutcome(
  channel: "sms" | "email",
  status: string,
  error?: string | null,
  carrierStatus?: string | null,
  carrierError?: string | null,
): RecipientOutcome {
  const effective =
    channel === "sms" && carrierStatus ? mergeCarrier(status, carrierStatus) : status
  const failError = carrierError ?? error

  switch (effective) {
    case "delivered":
      return { group: "delivered", label: "Delivered", detail: "Confirmed delivered.", variant: "success" }
    case "sent":
      return {
        group: "delivered",
        label: "Sent",
        detail: channel === "sms" ? "Handed off to the carrier." : "Sent through Brevo.",
        variant: "success",
      }
    case "queued":
      return { group: "inflight", label: "Queued", detail: "Waiting to send.", variant: "gold" }
    case "sending":
      return { group: "inflight", label: "Sending", detail: "Going out now.", variant: "gold" }
    case "skipped_opt_out":
      return {
        group: "skipped",
        label: "Opted out",
        detail: "They opted out of texts, so we respect it and skip them.",
        variant: "muted",
      }
    case "skipped_unsubscribed":
      return {
        group: "skipped",
        label: "Unsubscribed",
        detail: "They unsubscribed from email, so we skip them.",
        variant: "muted",
      }
    case "skipped_no_consent":
      return {
        group: "skipped",
        label: "No consent",
        detail: "Not opted in to recurring texts yet, so they were skipped. Send an opt-in request to reach them.",
        variant: "gold",
      }
    case "skipped_no_channel":
      return {
        group: "skipped",
        label: channel === "sms" ? "No phone" : "No email",
        detail:
          channel === "sms"
            ? "No phone number on this contact, so there was nothing to text."
            : "No email address on this contact, so there was nothing to send to.",
        variant: "warning",
      }
    case "undelivered":
    case "failed": {
      const ex = channel === "sms" ? explainTwilioError(failError, effective) : null
      if (ex) {
        return {
          group: "failed",
          label: "Failed",
          detail: ex.action ? `${ex.title}. ${ex.detail} ${ex.action}` : `${ex.title}. ${ex.detail}`,
          variant: "danger",
        }
      }
      const text = (failError ?? "").trim()
      return { group: "failed", label: "Failed", detail: text || "The send didn’t go through.", variant: "danger" }
    }
    default:
      return { group: "inflight", label: titleCase(effective), detail: "", variant: "default" }
  }
}

// The carrier's word (from the messages row) beats the recipient's "sent":
// delivered/undelivered/failed are the only states the webhook confirms.
function mergeCarrier(recipientStatus: string, carrier: string): string {
  if (carrier === "delivered") return "delivered"
  if (carrier === "undelivered" || carrier === "failed") return "failed"
  return recipientStatus
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")
}
