import type { Metadata } from "next"
import { Suspense } from "react"
import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Sign in",
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12 bg-bg">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <p className="eyebrow mb-3">Morning Star · Management</p>
          <h1 className="font-display text-title text-ink leading-tight">
            Welcome back
          </h1>
          <p className="mt-2 text-ink-muted text-lead">
            Sign in with the email on file. We&rsquo;ll send you a one-time link.
          </p>
        </div>

        <div className="rounded-lg bg-white border border-ink-hairline shadow-[var(--shadow-sm)] p-7">
          <Suspense fallback={<div className="h-44" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-8 text-ink-faint text-small text-center leading-prose">
          <em className="motto">Win souls and make disciples</em>
        </p>
      </div>
    </main>
  )
}
