"use client"
import { useActionState, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { requestCode, verifyCode, type LoginState } from "./actions"

type OAuthProvider = "google" | "apple"

// Providers to show are gated by env so we never render a button for a
// provider that isn't actually configured in Supabase (which would error on
// tap). Set NEXT_PUBLIC_OAUTH_PROVIDERS="google,apple" once each is enabled.
const OAUTH_PROVIDERS = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is OAuthProvider => s === "google" || s === "apple")

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Continue with Google",
  apple: "Continue with Apple",
}

const errorBox =
  "rounded-md bg-[color-mix(in_oklab,var(--color-danger)_10%,white)] border border-[color-mix(in_oklab,var(--color-danger)_30%,white)] text-danger px-3 py-2 text-small"
const fieldClass =
  "block w-full rounded-md border border-ink-hairline bg-white px-4 py-3 text-body text-ink placeholder:text-ink-fade focus:outline-none focus:ring-2 focus:ring-gold min-h-11"

export function LoginForm() {
  const params = useSearchParams()
  const nextPath = params.get("next") || ""

  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [reqPending, setReqPending] = useState(false)
  const [reqError, setReqError] = useState<string | null>(null)
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null)

  // Verify is a server action that redirects on success, so a form action +
  // useActionState handles it cleanly (error surfaces via state; success
  // navigates away).
  const [verState, verAction, verPending] = useActionState<LoginState, FormData>(
    verifyCode,
    null,
  )

  async function sendCode(fd: FormData) {
    setReqPending(true)
    setReqError(null)
    const result = await requestCode(null, fd)
    setReqPending(false)
    if (result?.ok) {
      setEmail(result.sentTo)
      setStep("code")
    } else if (result && result.ok === false) {
      setReqError(result.error)
    }
  }

  async function onEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await sendCode(new FormData(e.currentTarget))
  }

  function resend() {
    const fd = new FormData()
    fd.set("email", email)
    fd.set("next", nextPath)
    void sendCode(fd)
  }

  async function signInWith(provider: OAuthProvider) {
    setOauthPending(provider)
    try {
      const supabase = createSupabaseBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath || "/inbox")}`,
        },
      })
      if (error) {
        toast.error(`Sign-in failed: ${error.message}`)
        setOauthPending(null)
      }
      // On success the browser is already redirecting to the provider.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed")
      setOauthPending(null)
    }
  }

  return (
    <div className="space-y-5">
      {OAUTH_PROVIDERS.length > 0 && (
        <>
          <div className="space-y-2.5">
            {OAUTH_PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => signInWith(p)}
                disabled={oauthPending !== null}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-ink-hairline bg-white px-4 py-3 text-body font-medium text-ink hover:bg-surface transition-colors min-h-11 disabled:opacity-50"
              >
                {oauthPending === p ? "Redirecting…" : PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-ink-hairline" />
            <span className="text-micro text-ink-faint uppercase tracking-wide">or</span>
            <span className="h-px flex-1 bg-ink-hairline" />
          </div>
        </>
      )}

      {step === "code" ? (
        <form action={verAction} className="space-y-5">
          <input type="hidden" name="next" value={nextPath} />
          <input type="hidden" name="email" value={email} />
          <div className="space-y-2">
            <label htmlFor="token" className="block text-small font-medium text-ink-muted">
              Enter your code
            </label>
            <p className="text-small text-ink-faint">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-ink">{email}</span>. Enter it here
              to finish signing in.
            </p>
            <input
              id="token"
              name="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              placeholder="123456"
              className={`${fieldClass} text-center font-mono tracking-[0.4em] placeholder:tracking-normal`}
            />
          </div>

          {verState?.ok === false && (
            <p role="alert" className={errorBox}>
              {verState.error}
            </p>
          )}

          <button type="submit" disabled={verPending} className="btn-cta w-full" aria-disabled={verPending}>
            {verPending ? "Verifying…" : "Verify & sign in"}
          </button>

          <div className="flex items-center justify-between text-small">
            <button
              type="button"
              onClick={() => setStep("email")}
              className="text-ink-faint hover:text-ink underline underline-offset-2"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={resend}
              disabled={reqPending}
              className="text-gold hover:underline underline-offset-2 disabled:opacity-50"
            >
              {reqPending ? "Sending…" : "Resend code"}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={onEmailSubmit} className="space-y-5">
          <input type="hidden" name="next" value={nextPath} />
          <div className="space-y-2">
            <label htmlFor="email" className="block text-small font-medium text-ink-muted">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              defaultValue={email}
              placeholder="you@morningstarchurchboise.org"
              className={fieldClass}
            />
          </div>

          {reqError && (
            <p role="alert" className={errorBox}>
              {reqError}
            </p>
          )}

          <button type="submit" disabled={reqPending} className="btn-cta w-full" aria-disabled={reqPending}>
            {reqPending ? "Sending…" : "Send sign-in code"}
          </button>

          <p className="text-ink-faint text-small leading-prose">
            Sign-in is by invitation only. If you need access, ask an admin to add
            you in Settings.
          </p>
        </form>
      )}
    </div>
  )
}
