import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/safe-next"

/**
 * Magic link redirect handler. Supabase Auth sends the user here after
 * they click the email link. We exchange the code for a session, then
 * route them to either `next` (if provided) or `/inbox`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const next = safeNextPath(url.searchParams.get("next"))

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    )
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
