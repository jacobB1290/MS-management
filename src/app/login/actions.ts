"use server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { z } from "zod"

const schema = z.object({
  email: z.string().trim().email(),
  next: z.string().optional(),
})

export type LoginState = { ok: true; sentTo: string } | { ok: false; error: string } | null

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  })
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." }
  }

  const supabase = await createSupabaseServerClient()
  const origin = process.env.APP_BASE_URL ?? "http://localhost:3000"
  const next = parsed.data.next || "/inbox"
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
