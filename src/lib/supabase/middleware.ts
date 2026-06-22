import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "@/lib/database.types"

/**
 * Refresh the auth session on every request and gate authenticated routes.
 * Returns the response object that callers should return from middleware.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Demo mode: gate purely on the demo cookie, never contacting Supabase.
  // When DEMO_MODE isn't "1" this block is skipped entirely.
  if (process.env.DEMO_MODE === "1") {
    return updateDemoSession(request)
  }

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

  // Verify the session by reading the JWT claims. With asymmetric signing keys
  // this validates the token locally (no round-trip to the Auth server on every
  // request — that round-trip is what made navigation lag after the app sat
  // idle). It still refreshes an expired access token via getSession under the
  // hood, so sessions keep rotating and persist. On legacy HS256 projects it
  // transparently falls back to a server call, so there is no behavior change.
  const { data: claimsData } = await supabase.auth.getClaims()
  const authed = Boolean(claimsData?.claims)

  const path = request.nextUrl.pathname
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth")
  const isPublicWebhook =
    path.startsWith("/api/webhook") ||
    path.startsWith("/api/public-form") ||
    // Public, read-only feeds consumed by ms.church (published sermons, etc.).
    // They hard-filter to published rows in the handler and are CORS-open by
    // design, so they must bypass the /login redirect or the site fetches the
    // HTML sign-in page instead of JSON and silently falls back.
    path.startsWith("/api/public/") ||
    // Twilio's TwiML callback for browser voice calls — signature-verified in
    // the handler, and cookie-less, so it must bypass the /login redirect or
    // Twilio gets the login page HTML back and fails with 12100. Note this is
    // ONLY /api/voice/outbound; /api/voice/token stays staff-gated.
    path.startsWith("/api/voice/outbound")
  // Server-to-server endpoints — they authenticate via bearer header
  // (CRON_SECRET) or their own production fence. The proxy must NOT redirect
  // them to /login; the route handler must be allowed to run so it can
  // return 401 / 403 / 404 with the correct semantics.
  const isMachineRoute =
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/heartbeat") ||
    path.startsWith("/api/dev/")

  if (!authed && !isAuthRoute && !isPublicWebhook && !isMachineRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return NextResponse.redirect(url)
  }

  if (authed && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/inbox"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return response
}

/**
 * Demo-mode routing. The demo "session" is a single cookie; there is no real
 * auth. Mirrors the gating above (login/webhook/machine routes stay open) but
 * decides solely on the cookie, so no Supabase call is made.
 */
function updateDemoSession(request: NextRequest) {
  const hasDemo = request.cookies.get("ms_demo")?.value === "1"
  const path = request.nextUrl.pathname
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/auth")
  const isPublicWebhook =
    path.startsWith("/api/webhook") ||
    path.startsWith("/api/public-form") ||
    // Public, read-only feeds consumed by ms.church (published sermons, etc.).
    // They hard-filter to published rows in the handler and are CORS-open by
    // design, so they must bypass the /login redirect or the site fetches the
    // HTML sign-in page instead of JSON and silently falls back.
    path.startsWith("/api/public/") ||
    // Twilio's TwiML callback for browser voice calls — signature-verified in
    // the handler, and cookie-less, so it must bypass the /login redirect or
    // Twilio gets the login page HTML back and fails with 12100. Note this is
    // ONLY /api/voice/outbound; /api/voice/token stays staff-gated.
    path.startsWith("/api/voice/outbound")
  const isMachineRoute =
    path.startsWith("/api/cron/") ||
    path.startsWith("/api/heartbeat") ||
    path.startsWith("/api/dev/")

  if (!hasDemo && !isAuthRoute && !isPublicWebhook && !isMachineRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return NextResponse.redirect(url)
  }
  if (hasDemo && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/inbox"
    url.search = ""
    return NextResponse.redirect(url)
  }
  return NextResponse.next({ request })
}
