import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "No access",
}

export default function AccessDeniedPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12 bg-bg">
      <div className="w-full max-w-md text-center">
        <p className="eyebrow mb-3">403 · No access</p>
        <h1 className="font-display text-title text-ink leading-tight">
          You&rsquo;re signed in, but not on the team yet
        </h1>
        <p className="mt-3 text-ink-muted text-lead leading-normal">
          An admin needs to add your account before you can use the console.
          If you think this is a mistake, ask an admin to check the team list
          in Settings.
        </p>
        <form action="/logout" method="post" className="mt-8">
          <button type="submit" className="btn-cta btn-cta--secondary">
            Sign out
          </button>
        </form>
        <p className="mt-10 text-ink-faint text-small">
          <Link href="/login" className="underline underline-offset-4 hover:text-ink">
            Back to sign-in
          </Link>
        </p>
      </div>
    </main>
  )
}
