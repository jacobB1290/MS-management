import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "@/lib/database.types"

/**
 * Refresh the auth session on every request and gate authenticated routes.
 * Returns the response object that callers should return from middleware.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth")
  const isPublicWebhook = path.startsWith("/api/webhook") || path.startsWith("/api/public-form")
  // Server-to-server endpoints — they authenticate via bearer header
  // (CRON_SECRET) or their own production fence. The proxy must NOT redirect
  // them to /login; the route handler must be allowed to run so it can
  // return 401 / 403 / 404 with the correct semantics.
  const isMachineRoute =
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/heartbeat") ||
    path.startsWith("/api/dev/")

  if (!user && !isAuthRoute && !isPublicWebhook && !isMachineRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/inbox"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}
