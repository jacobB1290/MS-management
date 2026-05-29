import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

// GSM-7 default alphabet (GSM 03.38), including the Latin-1 accents it covers.
// A message built only from these characters stays 7-bit, so it fits 160 chars
// per segment. A single character outside the set — most relevantly Cyrillic,
// which our `language = 'ru'` contacts may have in their name — forces the whole
// message to UCS-2 (70 chars per segment) and silently multiplies send cost.
// The auto-reply copy is hand-kept ASCII (see welcome.ts); the one variable we
// inject is the contact's name, so we charset-guard *it* here and fall back to
// the equally-warm name-less copy when a name would break the 7-bit invariant.
const GSM7 = new Set(
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
)

/**
 * The first name to greet a contact by in an automated SMS, or `null` when we
 * have nothing safe to use (so the caller renders the name-less variant).
 *
 * Takes the first whitespace-delimited token of the stored name, upper-cases
 * its first character (a lowercased form entry shouldn't go out as "hi jacob"),
 * and only returns it when every character is GSM-7 representable — otherwise
 * inlining it could quietly push the message into UCS-2 (see the note above).
 */
export function smsGreetingName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0] ?? ""
  if (!first) return null
  const cased = first.charAt(0).toUpperCase() + first.slice(1)
  for (const ch of cased) {
    if (!GSM7.has(ch)) return null
  }
  return cased
}

/** Load a contact's name and resolve it to a safe SMS greeting name. */
export async function fetchSmsGreetingName(contactId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from("contacts")
    .select("name")
    .eq("id", contactId)
    .maybeSingle()
  return smsGreetingName(data?.name)
}
