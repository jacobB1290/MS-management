import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { isDemoEnabled, createDemoClient } from "@/server/demo"

export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  // On a demo deployment there is no real database — serve fixtures.
  if (isDemoEnabled()) return createDemoClient()
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components can't mutate cookies. The middleware client
            // handles refreshes; this catch is the standard Supabase SSR pattern.
          }
        },
      },
    },
  )
}

/**
 * Service-role client. Bypasses RLS. ONLY use server-side, in route handlers
 * or server actions, never in a Server Component that streams to the client.
 *
 * Module singleton: the admin client carries no cookies or session state, so
 * one instance serves every caller. Constructing a fresh client (GoTrue +
 * PostgREST instances) at each of the ~60 call sites was pure overhead.
 */
let adminClient: SupabaseClient<Database> | undefined

export function createSupabaseAdminClient(): SupabaseClient<Database> {
  if (isDemoEnabled()) return createDemoClient()
  if (adminClient) return adminClient
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Privileged ops require service role.",
    )
  }
  adminClient = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
  return adminClient
}
