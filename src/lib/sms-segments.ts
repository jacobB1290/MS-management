/**
 * SMS segment math for the campaign composer's live meter. Mirrors how
 * carriers actually bill: GSM-7 messages hold 160 characters (153 each once
 * the message spans several texts, because each part carries a UDH header);
 * any character outside the GSM 03.38 alphabet — emoji, curly quotes, most
 * non-Latin scripts — flips the whole message to UCS-2, where each text holds
 * 70 (67 concatenated). Twilio's Smart Encoding may transliterate some
 * offenders (’ → ') before sending, so this is a conservative ceiling, never
 * an undercount.
 */

// GSM 03.38 basic alphabet (each char = 1 septet).
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
// GSM 03.38 extension table (each char = 2 septets: ESC + char).
const GSM_EXTENDED = "^{}\\[~]|€"

const GSM_SET = new Set([...GSM_BASIC])
const GSM_EXT_SET = new Set([...GSM_EXTENDED])

export interface SmsSegmentInfo {
  /** Characters as a person counts them (Unicode code points). */
  chars: number
  /** True when the text forces UCS-2 (emoji / special characters). */
  unicode: boolean
  /** Billable texts this message sends as. 0 for an empty message. */
  segments: number
  /** Encoding units consumed (septets for GSM-7, UTF-16 units for UCS-2). */
  used: number
  /** Units available before the message grows by one more text. */
  capacity: number
}

export function smsSegmentInfo(text: string): SmsSegmentInfo {
  const points = [...text]
  const chars = points.length

  let unicode = false
  let septets = 0
  for (const p of points) {
    if (GSM_SET.has(p)) septets += 1
    else if (GSM_EXT_SET.has(p)) septets += 2
    else {
      unicode = true
      break
    }
  }

  // UCS-2 counts UTF-16 code units, so an emoji (surrogate pair) costs 2.
  const used = unicode ? text.length : septets
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153

  const segments = used === 0 ? 0 : used <= single ? 1 : Math.ceil(used / multi)
  const capacity = segments <= 1 ? single : segments * multi

  return { chars, unicode, segments, used, capacity }
}
