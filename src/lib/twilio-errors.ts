/**
 * Human-readable translations for Twilio messaging error codes, so staff see
 * what actually happened to a text instead of a raw number. Shared by the
 * inbox thread (failed-message bubble) and the send path.
 *
 * Two storage shapes feed in: the delivery-status webhook stores the bare
 * numeric ErrorCode (e.g. "30007"), while the send path stores the code too
 * (falling back to free text for non-Twilio failures like a network drop).
 * `explainTwilioError` handles all three: known code, unknown code, free text.
 */

/** Twilio's "recipient has opted out" code. The carrier blocks the send; only
 *  the contact texting START can lift it. Used to re-sync our opt-out flag. */
export const TWILIO_OPT_OUT_ERROR_CODE = 21610

export interface TwilioErrorExplanation {
  code: number | null
  /** Short label, e.g. "Recipient opted out". */
  title: string
  /** One plain sentence: what happened. */
  detail: string
  /** What staff can do about it, when there's a useful action. */
  action?: string
}

const TWILIO_ERROR_MAP: Record<number, Omit<TwilioErrorExplanation, "code">> = {
  21610: {
    title: "Recipient opted out",
    detail: "They texted STOP, so the mobile carrier blocks all texts to them.",
    action: "They must text START to your number to resubscribe; you can’t re-enable it from here.",
  },
  21211: {
    title: "Invalid phone number",
    detail: "This isn’t a valid number in the format the carrier expects.",
    action: "Check and fix the number on the contact.",
  },
  21408: {
    title: "Country not enabled",
    detail: "Texting to this number’s country isn’t turned on for your Twilio account.",
    action: "Enable the country under Messaging Geo Permissions in Twilio.",
  },
  21612: {
    title: "Number can’t be reached",
    detail: "This number can’t receive messages from your Messaging Service right now.",
    action: "Confirm it’s a mobile number, then try again later.",
  },
  21614: {
    title: "Not a mobile number",
    detail: "This looks like a landline or a line that can’t receive texts.",
    action: "Use a mobile number for SMS.",
  },
  21617: {
    title: "Message too long",
    detail: "The message is longer than the carrier allows.",
    action: "Shorten it and send again.",
  },
  30001: {
    title: "Carrier queue full",
    detail: "The carrier’s queue overflowed, which is usually temporary.",
    action: "Wait a bit, then tap retry.",
  },
  30002: {
    title: "Account suspended",
    detail: "Your Twilio account or sending number is suspended.",
    action: "Check your Twilio billing and compliance status.",
  },
  30003: {
    title: "Phone unreachable",
    detail: "Their handset was off or out of coverage.",
    action: "Try again later.",
  },
  30004: {
    title: "Message blocked",
    detail: "The carrier or the device blocked this message.",
    action: "Often spam filtering; review the wording and your 10DLC registration.",
  },
  30005: {
    title: "Unknown number",
    detail: "The number is unknown or no longer in service.",
    action: "Verify the number is still active.",
  },
  30006: {
    title: "Landline or unreachable carrier",
    detail: "The number is a landline, or its carrier can’t receive texts.",
    action: "Use a mobile number for SMS.",
  },
  30007: {
    title: "Carrier filtered (spam)",
    detail: "The carrier flagged this as spam and blocked it.",
    action: "Review the wording (avoid links and ALL CAPS) and confirm your 10DLC campaign is registered.",
  },
  30008: {
    title: "Carrier error",
    detail: "The carrier reported an unspecified delivery error.",
    action: "Try again; if it keeps failing, check Twilio’s status page.",
  },
  30019: {
    title: "Attachment too large",
    detail: "The picture or video was too large to deliver.",
    action: "Use a smaller file (under about 5 MB).",
  },
  30034: {
    title: "Number not 10DLC-registered",
    detail: "The sending number isn’t registered for A2P 10DLC, so carriers block it.",
    action: "Finish your 10DLC brand and campaign registration in Twilio.",
  },
}

/** Pull a leading Twilio error code out of whatever is stored in messages.error. */
export function parseTwilioErrorCode(error: string | null | undefined): number | null {
  if (!error) return null
  const match = /^\s*(\d{3,6})/.exec(error)
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * Translate a stored error (+ optional status) into something staff can read.
 * Returns null when there's nothing to explain (a success state with no error).
 */
export function explainTwilioError(
  error: string | null | undefined,
  status?: string | null,
): TwilioErrorExplanation | null {
  const code = parseTwilioErrorCode(error)
  if (code != null) {
    const known = TWILIO_ERROR_MAP[code]
    if (known) return { code, ...known }
    return {
      code,
      title: `Carrier error ${code}`,
      detail: "The carrier rejected this message with an uncommon code.",
      action: `Look up Twilio error ${code} for the specifics.`,
    }
  }

  const text = typeof error === "string" ? error.trim() : ""
  if (text) {
    return { code: null, title: "Send failed", detail: text }
  }
  if (status === "failed" || status === "undelivered") {
    return {
      code: null,
      title: "Delivery failed",
      detail: "The carrier didn’t deliver this message and didn’t say why.",
    }
  }
  return null
}
