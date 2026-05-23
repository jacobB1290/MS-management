import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

const schema = z.object({ endpoint: z.string().url().max(1000) })

/** Drop this device's push subscription. */
export async function POST(request: NextRequest) {
  const user = await requireStaff()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 422 })
  }

  const admin = createSupabaseAdminClient()
  // Scope the delete to the caller so one staffer can't drop another's device.
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", parsed.data.endpoint)
    .eq("user_id", user.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
