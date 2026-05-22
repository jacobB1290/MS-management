import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.auth.signOut()
  if (user) {
    await logAudit({ action: "auth.logout", actorUserId: user.id })
  }
  return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000"))
}
