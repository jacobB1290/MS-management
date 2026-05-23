import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

const schema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
  user_agent: z.string().max(400).optional().nullable(),
})

/** Store (or refresh) this device's push subscription for the current staffer. */
export async function POST(request: NextRequest) {
  const user = await requireStaff()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }
  const { endpoint, keys, user_agent } = parsed.data

  const admin = createSupabaseAdminClient()
  // Endpoint is globally unique. Re-subscribing or a device changing hands
  // should rebind it to the current user, so upsert on endpoint.
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: user_agent ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  )
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
