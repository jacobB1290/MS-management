import "server-only"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { redirect } from "next/navigation"
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server"
import { isDemoEnabled, hasDemoSession, DEMO_USER } from "@/server/demo"

export type StaffUser = {
  id: string
  email: string | null
  role: "admin" | "member"
  displayName: string | null
}

/**
 * `app_users` lookup cached for 60s per user across requests. Role + display
 * name barely change. Invalidate via `revalidateTag("app_users:<id>")` from
 * the team-management endpoints when a role flips.
 *
 * Uses the service-role client because `auth.getUser()` already proved the
 * identity — we just need the row, and we want the cache key to be the user
 * id (which is stable), not the cookie.
 */
const getAppUserCached = (userId: string) =>
  unstable_cache(
    async (id: string) => {
      const admin = createSupabaseAdminClient()
      const { data } = await admin
        .from("app_users")
        .select("role, display_name")
        .eq("user_id", id)
        .maybeSingle()
      return data
    },
    ["app_users", userId],
    { revalidate: 60, tags: ["app_users", `app_users:${userId}`] },
  )(userId)

/**
 * Resolve the current staff user. Wrapped in `React.cache` so multiple
 * Server Components in the same request share one resolution — the (app)
 * layout, the inbox layout, and the page each call this and now they get
 * the same dedup'd Promise instead of fanning out into N auth round-trips.
 */
export const requireStaff = cache(async (): Promise<StaffUser> => {
  // Demo mode: the static demo user, gated on the demo cookie so the login
  // step still applies. Never touches Supabase.
  if (isDemoEnabled()) {
    if (await hasDemoSession()) return DEMO_USER
    redirect("/login")
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const appUser = await getAppUserCached(user.id)
  if (!appUser) redirect("/access-denied")

  return {
    id: user.id,
    email: user.email ?? null,
    role: (appUser.role as "admin" | "member") ?? "member",
    displayName: appUser.display_name,
  }
})

export const requireAdmin = cache(async (): Promise<StaffUser> => {
  const user = await requireStaff()
  if (user.role !== "admin") redirect("/access-denied")
  return user
})
