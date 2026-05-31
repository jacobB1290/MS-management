"use client"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"]

const order = (k: string) => (k === "#" ? 26 : k.charCodeAt(0) - 65)

/**
 * iOS-style A–Z scrubber down the right edge. Tap or drag a finger over it to
 * jump the list to that letter's section (snapping to the nearest section that
 * actually has contacts). Present letters are gold and active; empty letters are
 * faded but still scrub to the nearest neighbour, matching the native control.
 *
 * Accessibility: it's a real `navigation` landmark and each present letter is a
 * focusable button, so VoiceOver and keyboard users get the same accelerator —
 * the pointer drag is an enhancement layered on top, not the only way in.
 */
export function ContactsIndex({ present }: { present: string[] }) {
  const presentSet = new Set(present)
  const dragging = useRef(false)
  // The big centred glyph shown over the finger while scrubbing, like the
  // native index. null = not scrubbing.
  const [bubble, setBubble] = useState<string | null>(null)

  function targetFor(letter: string): string | null {
    if (presentSet.has(letter)) return letter
    // Nearest present section at or after the letter, else the last one.
    const li = order(letter)
    let after: string | null = null
    for (const p of present) {
      if (order(p) >= li) {
        after = p
        break
      }
    }
    return after ?? present[present.length - 1] ?? null
  }

  function jumpTo(letter: string) {
    const t = targetFor(letter)
    if (!t) return
    setBubble(t)
    document.getElementById(`csec-${t}`)?.scrollIntoView({
      block: "start",
      // Smooth on a tap/keyboard activation; instant while a drag is tracking
      // the finger 1:1 (a queue of smooth scrolls would lag behind the drag).
      // Reduced-motion neutralizes "smooth" to instant globally.
      behavior: dragging.current ? "auto" : "smooth",
    })
  }

  function endScrub() {
    dragging.current = false
    setBubble(null)
  }

  function letterAtPoint(clientY: number, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const i = Math.floor(((clientY - r.top) / r.height) * LETTERS.length)
    return LETTERS[Math.min(LETTERS.length - 1, Math.max(0, i))]
  }

  return (
    <>
      {/* Active-letter bubble: a large glyph centred on screen while scrubbing,
          mirroring the native iOS index. Fades with the motion tokens. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2",
          "flex h-20 w-20 items-center justify-center rounded-3xl",
          "bg-ink/80 font-display text-4xl font-semibold text-white backdrop-blur",
          "transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
          bubble ? "opacity-100" : "opacity-0",
        )}
      >
        {bubble}
      </div>

      <nav
        aria-label="Section index"
        // Wide, edge-hugging touch column so the drag target is comfortably
        // grabbable even though the glyphs stay small (the native pattern).
        className="absolute right-0 top-1/2 z-20 flex w-7 -translate-y-1/2 select-none flex-col items-center py-2"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          jumpTo(letterAtPoint(e.clientY, e.currentTarget))
        }}
        onPointerMove={(e) => {
          if (dragging.current) jumpTo(letterAtPoint(e.clientY, e.currentTarget))
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        {LETTERS.map((l) => {
          const isPresent = presentSet.has(l)
          return (
            <button
              key={l}
              type="button"
              // Empty letters still scrub-snap under a finger drag, but they're
              // not useful standalone targets, so keep them out of the tab order.
              tabIndex={isPresent ? 0 : -1}
              aria-hidden={isPresent ? undefined : true}
              aria-label={isPresent ? `Jump to ${l === "#" ? "other" : l}` : undefined}
              onClick={() => jumpTo(l)}
              onFocus={() => isPresent && setBubble(targetFor(l))}
              onBlur={() => !dragging.current && setBubble(null)}
              className={cn(
                "block px-1 text-[10px] font-semibold leading-[1.18]",
                "focus-visible:outline-none focus-visible:text-gold-dark",
                isPresent ? "text-gold" : "text-ink-faint/40",
              )}
            >
              {l}
            </button>
          )
        })}
      </nav>
    </>
  )
}
