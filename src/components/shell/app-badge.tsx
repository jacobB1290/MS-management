"use client"
import { useEffect } from "react"

/**
 * Mirrors the awaiting-reply count onto the installed app's Home Screen icon
 * (iOS 16.4+ / Safari, plus Chromium desktop) via the Badging API. On iOS the
 * badge only renders once the user has granted notification permission, but
 * calling it unconditionally is harmless otherwise — so we don't gate on
 * permission or prompt. `count` is re-fed by the server layout (LiveRefresh's
 * router.refresh keeps it fresh), so the badge tracks the inbox automatically.
 * Renders nothing.
 */
export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return

    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {})
    } else {
      navigator.clearAppBadge().catch(() => {})
    }

    // Clear on unmount (e.g. sign-out) so a stale count doesn't linger.
    return () => {
      navigator.clearAppBadge().catch(() => {})
    }
  }, [count])

  return null
}
