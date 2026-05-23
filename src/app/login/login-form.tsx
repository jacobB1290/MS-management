"use client"
import { useActionState } from "react"
import { useSearchParams } from "next/navigation"
import { requestMagicLink, type LoginState } from "./actions"

export function LoginForm() {
  const params = useSearchParams()
  const nextPath = params.get("next") || ""
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    requestMagicLink,
    null,
  )

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="font-display text-heading text-ink">Check your email</p>
        <p className="text-ink-muted text-body leading-normal">
          We sent a sign-in link to{" "}
          <span className="font-medium text-ink">{state.sentTo}</span>. Click it
          to come back here. The link is good for 60 minutes.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={nextPath} />
      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-small font-medium text-ink-muted"
        >
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@morningstarchurchboise.org"
          className="block w-full rounded-md border border-ink-hairline bg-white px-4 py-3 text-body text-ink placeholder:text-ink-fade focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-0 min-h-11"
        />
      </div>

      {state?.ok === false && (
        <p
          role="alert"
          className="rounded-md bg-[color-mix(in_oklab,var(--color-danger)_10%,white)] border border-[color-mix(in_oklab,var(--color-danger)_30%,white)] text-danger px-3 py-2 text-small"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn-cta w-full"
        aria-disabled={pending}
      >
        {pending ? "Sending…" : "Send sign-in link"}
      </button>

      <p className="text-ink-faint text-small leading-prose">
        Sign-in is by invitation only. If you need access, ask an admin to add
        you in Settings.
      </p>
    </form>
  )
}
