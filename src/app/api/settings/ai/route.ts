import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/server/auth"
import { logAudit } from "@/server/audit"
import { normalizeConfig, AI_SETTINGS_KEY } from "@/server/ai/config"
import type { Json } from "@/lib/database.types"

/**
 * Persist the per-feature AI model/effort selection. Admin-only. The body is
 * normalized against the known choices (unknown values fall back to defaults),
 * so a malformed payload can never store an invalid model.
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin()

  const config = normalizeConfig(await request.json().catch(() => null))

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from("app_settings").upsert(
    {
      key: AI_SETTINGS_KEY,
      value: config as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "key" },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: "settings.ai_update",
    actorUserId: user.id,
    targetTable: "app_settings",
    targetId: AI_SETTINGS_KEY,
    diff: config,
  })

  return NextResponse.json({ ok: true, config })
}
