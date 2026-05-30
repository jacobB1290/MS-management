"use client"
import { useEffect } from "react"

/**
 * Recover a stale PWA on return from a long background.
 *
 * On mobile (especially iOS), a web app that has been backgrounded for a while
 * gets its JS runtime suspended. When you come back the UI is still on screen
 * but it's wedged: the realtime socket is dead, the auth token may be stuck
 * mid-refresh (behind a Web Lock), and taps do nothing. A soft refresh
 * (router.refresh) runs INSIDE that same wedged runtime, so it can't fix it —
 * only a full reload gets a fresh JS context, auth cookies, and socket.
 *
 * So: remember when we were hidden, and if we come back after a long absence,
 * hard-reload. Short absences keep using the in-app reconcile-on-refocus (which
 * preserves composer text + scroll); this is the escalation for "idle too long".
 *
 * The service worker is push-only (no fetch caching), so a reload always pulls
 * the latest from the network. Mounted app-wide — including the inbox, which
 * LiveRefresh deliberately sits out — because that's where staff live.
 */
const STALE_MS = 15 * 60 * 1000

export function StaleReload() {
  useEffect(() => {
    let hiddenAt = 0

    const recoverIfStale = () => {
      if (!hiddenAt) return
      const awayFor = Date.now() - hiddenAt
      hiddenAt = 0
      // Don't reload offline — there's no SW cache to fall back on, so it would
      // just error. The next online return will catch it.
      if (awayFor > STALE_MS && navigator.onLine !== false) {
        window.location.reload()
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now()
      else recoverIfStale()
    }
    // bfcache restore (e.g. iOS back-swipe into a frozen page) runs the same
    // staleness check; hiddenAt survives in the restored JS state.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) recoverIfStale()
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pageshow", onPageShow)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [])

  return null
}
