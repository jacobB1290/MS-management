import "server-only"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export type StaffUser = {
  id: string
  email: string | null
  role: "admin" | "member"
  displayName: string | null
}

/**
 * Resolve the current staff user — throws redirect to /login if not signed
 * in, throws to /access-denied if signed in without an app_users row.
 */
export async function requireStaff(): Promise<StaffUser> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, display_name")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!appUser) redirect("/access-denied")

  return {
    id: user.id,
    email: user.email ?? null,
    role: (appUser.role as "admin" | "member") ?? "member",
    displayName: appUser.display_name,
  }
}

export async function requireAdmin(): Promise<StaffUser> {
  const user = await requireStaff()
  if (user.role !== "admin") redirect("/access-denied")
  return user
}
