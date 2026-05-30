"use client"
import { useEffect } from "react"

interface SafariNavigator extends Navigator {
  standalone?: boolean
}

/**
 * iOS/WebKit runtime niceties that need the live viewport. Renders nothing.
 *
 * 1. Marks `<html data-standalone>` when launched as an installed Home Screen
 *    web app, so styles can branch on it if ever needed.
 *
 * 2. Keyboard avoidance. The body is `position: fixed` (to kill rubber-band
 *    scrolling), so iOS does NOT shrink it when the on-screen keyboard opens —
 *    a sticky composer would sit behind the keyboard. We measure the covered
 *    height from `visualViewport` and publish it as `--keyboard-inset`; the
 *    body lifts its bottom edge by that much (see globals.css). The value
 *    self-corrects against `interactive-widget: resizes-content`: where the
 *    layout viewport already shrank, the computed inset is ~0, so we never
 *    double-count.
 */
export function PlatformEnhancements() {
  useEffect(() => {
    const root = document.documentElement

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (window.navigator as SafariNavigator).standalone === true
    if (standalone) root.dataset.standalone = "true"

    const vv = window.visualViewport
    if (!vv) return

    let raf = 0
    const apply = () => {
      raf = 0
      // Height of the layout viewport the keyboard covers. offsetTop handles
      // iOS scrolling content up under the keyboard.
      const covered = window.innerHeight - vv.height - vv.offsetTop
      // Ignore sub-keyboard jitter (toolbar show/hide is well below this).
      const inset = covered > 120 ? Math.round(covered) : 0
      root.style.setProperty("--keyboard-inset", `${inset}px`)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(apply)
    }

    vv.addEventListener("resize", schedule)
    vv.addEventListener("scroll", schedule)
    apply()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener("resize", schedule)
      vv.removeEventListener("scroll", schedule)
      root.style.removeProperty("--keyboard-inset")
    }
  }, [])

  return null
}
