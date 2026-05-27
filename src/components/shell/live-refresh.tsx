"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

/**
 * App-wide liveness. The inbox list and open thread keep themselves live with
 * their own subscriptions, but every other server-rendered surface (contact
 * pages, campaigns, the awaiting-reply badge, audit) would otherwise only
 * reflect changes on a manual refresh. This mounts once in the app shell,
 * shares the singleton's authed socket, and reconciles the current route when
 * the underlying data actually changes — so the system feels live everywhere
 * at once, not one pane at a time.
 *
 * router.refresh() re-runs the server components without unmounting client
 * state (composer text, scroll, optimistic rows survive), and it's cheap now
 * that auth is verified locally and the awaiting-reply count is cached. Bursts
 * (e.g. a campaign send) are coalesced: debounced, but forced through at least
 * every few seconds so the UI never stalls behind a long stream of inserts.
 */
const DEBOUNCE_MS = 600
const MAX_WAIT_MS = 4000

export function LiveRefresh() {
  const router = useRouter()

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null
    let firstPendingAt = 0

    const run = () => {
      debounce = null
      firstPendingAt = 0
      if (document.visibilityState === "visible") router.refresh()
    }

    const schedule = () => {
      // Don't churn while the tab is backgrounded; we reconcile on refocus.
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (!firstPendingAt) firstPendingAt = now
      if (debounce) clearTimeout(debounce)
      const wait = Math.min(DEBOUNCE_MS, Math.max(0, firstPendingAt + MAX_WAIT_MS - now))
      debounce = setTimeout(run, wait)
    }

    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel("app:live-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, schedule)
      .subscribe()

    // Coming back to the tab: pull fresh server state once, immediately.
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      if (debounce) clearTimeout(debounce)
      document.removeEventListener("visibilitychange", onVisible)
      void supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
