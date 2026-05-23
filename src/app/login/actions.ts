"use server"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/safe-next"
import { z } from "zod"

export type LoginState = { ok: true; sentTo: string } | { ok: false; error: string } | null

const requestSchema = z.object({
  email: z.string().trim().email(),
  next: z.string().optional(),
})

/**
 * Step 1: send a 6-digit sign-in code to the email. We still pass
 * emailRedirectTo so the magic link in the email keeps working as a
 * same-browser fallback, but the primary, cross-context-safe path is the code
 * entered in step 2 — that's what survives the link opening in the wrong
 * browser on iOS.
 */
export async function requestCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = requestSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  })
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." }
  }

  const supabase = await createSupabaseServerClient()
  const origin = process.env.APP_BASE_URL ?? "http://localhost:3000"
  const next = safeNextPath(parsed.data.next)
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: false, // staff are invited; no public signup
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true, sentTo: parsed.data.email }
}

const verifySchema = z.object({
  email: z.string().trim().email(),
  token: z.string().trim().regex(/^\d{6}$/),
  next: z.string().optional(),
})

/**
 * Step 2: verify the code. `verifyOtp` is a direct token check — no PKCE
 * code_verifier — so it succeeds in whatever instance the code is typed into.
 * The request carries this instance's cookies, so the session lands here, in
 * the right browser/PWA. On success we redirect; the session cookies are set
 * server-side on the redirect response (durable on iOS).
 */
export async function verifyCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = verifySchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
    next: formData.get("next"),
  })
  if (!parsed.success) {
    return { ok: false, error: "Enter the 6-digit code from your email." }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  })
  if (error) {
    return { ok: false, error: "That code is incorrect or expired. Request a new one." }
  }

  redirect(safeNextPath(parsed.data.next))
}
