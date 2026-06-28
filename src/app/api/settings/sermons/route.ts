import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { SERMON_SETTINGS_KEY, normalizeSermonSettings } from "@/server/sermons/config"
import type { Json } from "@/lib/database.types"

/**
 * Persist the Sermons (services) settings — the two auto-publish modes.
 * Admin-only. The body is normalized to the typed shape (unknown keys dropped,
 * non-booleans coerced to false), so a malformed payload can never store an
 * accidental "publish everything" state.
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin()

  const settings = normalizeSermonSettings(await request.json().catch(() => null))

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("app_settings").upsert(
    {
      key: SERMON_SETTINGS_KEY,
      value: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "settings.sermons_update",
    actorUserId: user.id,
    targetTable: "app_settings",
    targetId: SERMON_SETTINGS_KEY,
    diff: settings,
  })

  return NextResponse.json({ ok: true, settings })
}
