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
 *    a sticky composer would sit behind the keyboard. We publish the covered
 *    height as `--keyboard-inset` and the body lifts its bottom edge by that
 *    much (see globals.css).
 *
 *    Critically, the inset is gated on a text field actually being focused: if
 *    nothing is focused, the keyboard can't be up, so the inset is forced to 0.
 *    Without this gate the inset could get STUCK at the keyboard's height — iOS
 *    suspends the JS runtime when backgrounded and can miss the visualViewport
 *    `resize` that fires on keyboard dismissal, leaving the body permanently
 *    lifted (a dead band below the bottom nav). The gate, plus recomputing on
 *    focus/visibility/return, makes a stuck inset self-heal.
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

    const isTextEntry = () => {
      const el = document.activeElement
      if (!(el instanceof HTMLElement)) return false
      if (el.isContentEditable) return true
      const tag = el.tagName
      // A non-text input (button/checkbox/etc.) doesn't open the keyboard.
      if (tag === "TEXTAREA") return true
      if (tag === "INPUT") {
        const t = (el as HTMLInputElement).type
        return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(t)
      }
      return false
    }

    let raf = 0
    const apply = () => {
      raf = 0
      // No focused text field → the keyboard cannot be open → no inset. This is
      // what makes a stuck inset (missed keyboard-close event after a
      // background/resume) self-heal the moment anything is focused/blurred or
      // the app returns to the foreground.
      if (!isTextEntry()) {
        root.style.setProperty("--keyboard-inset", "0px")
        return
      }
      // Height of the layout viewport the keyboard covers. offsetTop handles
      // iOS scrolling content up under the keyboard.
      const covered = window.innerHeight - vv.height - vv.offsetTop
      // Ignore sub-keyboard jitter (toolbar show/hide is well below this), and
      // cap at 60% of the viewport — a keyboard is never taller than that, so a
      // transient bad measurement can't lift the body off the screen.
      const max = window.innerHeight * 0.6
      const inset = covered > 120 ? Math.min(Math.round(covered), max) : 0
      root.style.setProperty("--keyboard-inset", `${inset}px`)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(apply)
    }

    vv.addEventListener("resize", schedule)
    vv.addEventListener("scroll", schedule)
    // Focus changes flip the gate; visibility/return recompute so a stuck inset
    // from a missed keyboard-close while backgrounded clears on resume.
    document.addEventListener("focusin", schedule)
    document.addEventListener("focusout", schedule)
    document.addEventListener("visibilitychange", schedule)
    window.addEventListener("pageshow", schedule)
    apply()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener("resize", schedule)
      vv.removeEventListener("scroll", schedule)
      document.removeEventListener("focusin", schedule)
      document.removeEventListener("focusout", schedule)
      document.removeEventListener("visibilitychange", schedule)
      window.removeEventListener("pageshow", schedule)
      root.style.removeProperty("--keyboard-inset")
    }
  }, [])

  return null
}
