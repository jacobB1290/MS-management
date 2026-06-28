import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  SERMON_SETTINGS_KEY,
  SERMON_SETTINGS_DEFAULTS,
  normalizeSermonSettings,
  type SermonSettings,
} from "@/lib/sermon-settings"

/**
 * DB-backed Sermons settings: the auto-publish modes. Admins set them in
 * Settings → Services; they persist in `app_settings` under the `sermons` key,
 * so flipping a mode never needs a redeploy.
 *
 * Reads go through the service-role client (RLS-exempt) and are validated by
 * `normalizeSermonSettings` with the safe defaults (both off) as the fallback —
 * a malformed or missing row can never crash a pipeline write or cause an
 * accidental publish. All the pure validation lives in the client-safe
 * `@/lib/sermon-settings`, re-exported here for server callers.
 */
export * from "@/lib/sermon-settings"

type Admin = ReturnType<typeof createSupabaseAdminClient>

/** The current Sermons settings. Falls back to defaults on any read error. */
export async function getSermonsConfig(admin?: Admin): Promise<SermonSettings> {
  try {
    const client = admin ?? createSupabaseAdminClient()
    const { data } = await client
      .from("app_settings")
      .select("value")
      .eq("key", SERMON_SETTINGS_KEY)
      .maybeSingle()
    return normalizeSermonSettings(data?.value)
  } catch {
    return SERMON_SETTINGS_DEFAULTS
  }
}
