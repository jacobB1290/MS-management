"use client"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/** Reads prefers-reduced-motion without a sync setState-in-effect, and stays
 *  correct if the OS setting changes. SSR snapshot is false (animate). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY)
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
}

// The operator-only AI aside (e.g. "couldn't find that in the knowledge base").
// It lingers, then fades on its own. Staff asked for it to stay noticeably
// longer than before (~6s), to KEEP while pressed-and-held, and to be
// swipe-down dismissable.
const VISIBLE_MS = 15000
// After releasing a hold (or a tap), give a short grace rather than restoring
// the full timer.
const GRACE_MS = 5000
// Drag at least this far down to dismiss; anything less snaps back.
const DISMISS_AFTER_PX = 56

export function AiNote({ note, onDismiss }: { note: string; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [leaving, setLeaving] = useState<null | "up" | "down">(null)
  const [held, setHeld] = useState(false)
  const reduced = usePrefersReducedMotion()

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startYRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const dismissedRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const startTimer = (ms: number) => {
    clearTimer()
    timerRef.current = setTimeout(() => setLeaving("up"), ms)
  }
  const finish = () => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    onDismiss()
  }

  // Enter on the next frame so the transition runs from the initial state.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    startTimer(VISIBLE_MS)
    return () => {
      cancelAnimationFrame(id)
      clearTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Safety net: if the exit transition never fires (reduced motion, an
  // interrupted transition), still remove the note.
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(finish, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving])

  function onPointerDown(e: React.PointerEvent) {
    if (leaving) return
    startYRef.current = e.clientY
    draggingRef.current = true
    setHeld(true)
    clearTimer() // holding keeps it visible
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current || startYRef.current == null) return
    const dy = e.clientY - startYRef.current
    setDragY(dy > 0 ? dy : 0) // track downward only
  }
  function endDrag() {
    if (!draggingRef.current) return
    draggingRef.current = false
    setHeld(false)
    startYRef.current = null
    if (dragY > DISMISS_AFTER_PX) {
      setLeaving("down")
    } else {
      setDragY(0)
      startTimer(GRACE_MS) // resume the countdown after release
    }
  }

  let transform: string
  let opacity: number
  let transition: string
  if (leaving === "down") {
    transform = "translateY(140%)"
    opacity = 0
    transition = reduced ? "opacity 140ms linear" : "transform 220ms ease-in, opacity 220ms ease-in"
  } else if (leaving === "up") {
    transform = "translateY(-6px)"
    opacity = 0
    transition = reduced ? "opacity 200ms linear" : "transform 260ms ease-in, opacity 260ms ease-in"
  } else if (dragY > 0) {
    transform = `translateY(${dragY}px)`
    opacity = Math.max(0.35, 1 - dragY / 200)
    transition = "none" // follow the finger
  } else if (mounted) {
    transform = "translateY(0)"
    opacity = 1
    transition = reduced
      ? "opacity 160ms linear"
      : "transform 240ms cubic-bezier(0.22,1,0.36,1), opacity 240ms ease-out"
  } else {
    transform = "translateY(8px)"
    opacity = 0
    transition = "none"
  }

  function onTransitionEnd(e: React.TransitionEvent) {
    if (leaving && (e.propertyName === "transform" || e.propertyName === "opacity")) {
      finish()
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-3 md:inset-x-6 bottom-full z-10 mb-2"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTransitionEnd={onTransitionEnd}
        style={{ transform, opacity, transition, touchAction: "none" }}
        className={cn(
          "pointer-events-auto flex items-start gap-2 rounded-lg border border-gold/40 bg-white px-3 py-2 shadow-md select-none",
          held ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <Sparkles size={14} className="mt-0.5 shrink-0 text-gold-dark" />
        <p className="text-small leading-prose text-ink-muted">{note}</p>
      </div>
    </div>
  )
}
