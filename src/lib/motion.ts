import { motion } from "@/design/tokens"

/**
 * Numeric mirrors of the motion tokens for the places JS must wait out a CSS
 * exit animation (overlays that animate closed before unmounting). Derived
 * from the same `src/design/tokens.ts` values the CSS uses, so a token change
 * can never drift from the JS timers again (the Sheet previously hardcoded
 * 220ms against a 300ms transition and clipped the last 80ms of every close).
 */
const toMs = (s: string) => Math.round(parseFloat(s) * 1000)

export const MOTION_FAST_MS = toMs(motion.fast)
export const MOTION_MEDIUM_MS = toMs(motion.medium)

/** True when the OS asks for reduced motion (client-only; false during SSR). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * How long to hold an exiting overlay in the DOM so its close animation can
 * finish. Under reduced motion the CSS collapses to ~0ms, so the hold must
 * too — otherwise dismissal feels laggy instead of calm.
 */
export function exitDurationMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms
}
