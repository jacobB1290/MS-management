import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import type { Database } from "@/lib/database.types"

/**
 * Dev-only sign-in for the Playwright harness. Defense in depth:
 *   1. Refuses unless NODE_ENV !== "production".
 *   2. Refuses unless ALLOW_DEV_SIGNIN === "1" is set explicitly.
 *   3. Refuses unless the seeded test admin email + password env are set
 *      (so the route is dead in any environment that hasn't been bootstrapped).
 *
 * Returns a true 404 (no body) when disabled so the route doesn't disclose itself.
 */
export async function GET(request: NextRequest) {
  return handleDevSignIn(request)
}

export async function POST(request: NextRequest) {
  return handleDevSignIn(request)
}

async function handleDevSignIn(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 })
  }
  if (process.env.ALLOW_DEV_SIGNIN !== "1") {
    return new NextResponse(null, { status: 404 })
  }
  const email = process.env.DEV_TEST_ADMIN_EMAIL ?? "admin@dev.local"
  const password = process.env.DEV_TEST_ADMIN_PASSWORD ?? "harness-dev-only"
  if (!email || !password) {
    return new NextResponse(null, { status: 404 })
  }

  const response = NextResponse.redirect(new URL("/inbox", request.nextUrl.origin))

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  return response
}
