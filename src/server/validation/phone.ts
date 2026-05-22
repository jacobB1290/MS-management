import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js"

/**
 * Normalize any phone string to E.164. Returns null when the input cannot
 * be parsed into a valid number. ALWAYS use this before writing a phone
 * to the DB or comparing against an existing contact — the database CHECK
 * is a safety net, not the primary gate.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number // E.164 form, e.g. "+15551234567"
}

/** Returns true if the string is a valid E.164 number. */
export function isE164(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\+[1-9]\d{1,14}$/.test(value)
}
