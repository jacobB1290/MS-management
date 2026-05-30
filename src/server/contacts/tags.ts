import "server-only"
import { unstable_cache } from "next/cache"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Flattened tag occurrences across all contacts — with duplicates, so callers
 * can both dedupe for a vocabulary (the contact + campaign tag pickers) and
 * tally for counts (the campaign audience picker).
 *
 * Every page that shows a tag picker used to re-scan `contacts.select("tags")`
 * on each load. The tag vocabulary changes rarely and is identical for every
 * staff member, so scan it once with the admin client and cache it briefly
 * (a new tag shows up within a minute; pickers are freeform regardless).
 */
export const getContactTagOccurrences = unstable_cache(
  async (): Promise<string[]> => {
    const admin = createSupabaseAdminClient()
    const { data } = await admin.from("contacts").select("tags").limit(5000)
    return (data ?? []).flatMap((r) => (r.tags ?? []) as string[])
  },
  ["contact-tag-occurrences"],
  { revalidate: 60, tags: ["contact-tags"] },
)
