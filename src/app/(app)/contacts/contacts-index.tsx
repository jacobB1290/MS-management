"use client"
import { useRef } from "react"
import { cn } from "@/lib/utils"

const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"]

const order = (k: string) => (k === "#" ? 26 : k.charCodeAt(0) - 65)

/**
 * iOS-style A–Z scrubber down the right edge. Tap or drag a finger over it to
 * jump the list to that letter's section (snapping to the nearest section that
 * actually has contacts). Present letters are gold and active; empty letters are
 * faded but still scrub to the nearest neighbour, matching the native control.
 */
export function ContactsIndex({ present }: { present: string[] }) {
  const presentSet = new Set(present)
  const dragging = useRef(false)

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
    document.getElementById(`csec-${t}`)?.scrollIntoView({ block: "start" })
  }

  function letterAtPoint(clientY: number, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const i = Math.floor(((clientY - r.top) / r.height) * LETTERS.length)
    return LETTERS[Math.min(LETTERS.length - 1, Math.max(0, i))]
  }

  return (
    <div
      className="absolute right-0.5 top-1/2 z-20 flex -translate-y-1/2 select-none flex-col items-center py-2"
      style={{ touchAction: "none" }}
      aria-hidden
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        jumpTo(letterAtPoint(e.clientY, e.currentTarget))
      }}
      onPointerMove={(e) => {
        if (dragging.current) jumpTo(letterAtPoint(e.clientY, e.currentTarget))
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
    >
      {LETTERS.map((l) => (
        <span
          key={l}
          className={cn(
            "px-1.5 text-[10px] font-semibold leading-[1.18]",
            presentSet.has(l) ? "text-gold" : "text-ink-faint/40",
          )}
        >
          {l}
        </span>
      ))}
    </div>
  )
}
