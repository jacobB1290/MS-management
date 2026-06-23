"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Clock, Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Two copy buttons on the sermon detail Transcript section:
 *  - "Copy" grabs the plain transcript (already loaded on the page).
 *  - "Copy with timestamps" lazily fetches the timestamped transcript the
 *    segmenter feeds the model (re-downloaded on demand via the API route),
 *    so staff can paste it elsewhere and verify segmentation against the exact
 *    LLM input.
 * Labels stay constant; only the leading icon swaps (fade-in keyed by state),
 * so confirmation animates with zero layout shift and reduced-motion lands on
 * the right end state.
 */

type CopyState = "idle" | "copied" | "error"

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function StateIcon({
  state,
  base,
  loading,
}: {
  state: CopyState
  base: React.ReactNode
  loading?: boolean
}) {
  const icon = loading ? (
    <Loader2 size={15} className="animate-spin" />
  ) : state === "copied" ? (
    <Check size={15} />
  ) : state === "error" ? (
    <AlertCircle size={15} />
  ) : (
    base
  )
  // Remount on each state change so the new icon fades in.
  return (
    <span
      key={loading ? "loading" : state}
      aria-hidden
      className="inline-flex animate-[fade-in_var(--motion-fast)_var(--ease-out-soft)] motion-reduce:animate-none"
    >
      {icon}
    </span>
  )
}

export function TranscriptActions({
  sermonId,
  plain,
}: {
  sermonId: string
  plain: string | null
}) {
  const [plainState, setPlainState] = useState<CopyState>("idle")
  const [tsState, setTsState] = useState<CopyState>("idle")
  const [loadingTs, setLoadingTs] = useState(false)
  const [live, setLive] = useState("")
  const tsCache = useRef<string | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const list = timers.current
    return () => list.forEach(clearTimeout)
  }, [])

  const flash = useCallback(
    (set: (s: CopyState) => void, state: CopyState, message: string) => {
      set(state)
      setLive(message)
      timers.current.push(setTimeout(() => set("idle"), 1600))
    },
    [],
  )

  const copyPlain = useCallback(async () => {
    if (!plain) return
    const ok = await writeClipboard(plain)
    flash(setPlainState, ok ? "copied" : "error", ok ? "Transcript copied" : "Copy failed")
  }, [plain, flash])

  const copyTimestamped = useCallback(async () => {
    let text = tsCache.current
    if (text == null) {
      setLoadingTs(true)
      setLive("Fetching the timestamped transcript")
      try {
        const r = await fetch(`/api/sermons/${sermonId}/transcript`, {
          headers: { Accept: "application/json" },
        })
        const j = (await r.json().catch(() => null)) as { timestamped?: unknown } | null
        if (!r.ok || !j || typeof j.timestamped !== "string") {
          flash(setTsState, "error", "Could not load the timestamped transcript")
          return
        }
        text = j.timestamped
        tsCache.current = text
      } catch {
        flash(setTsState, "error", "Could not load the timestamped transcript")
        return
      } finally {
        setLoadingTs(false)
      }
    }
    const ok = await writeClipboard(text)
    flash(
      setTsState,
      ok ? "copied" : "error",
      ok ? "Timestamped transcript copied" : "Copy failed",
    )
  }, [sermonId, flash])

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copyPlain}
        disabled={!plain}
        aria-label="Copy the plain transcript"
      >
        <StateIcon state={plainState} base={<Copy size={15} />} />
        Copy
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copyTimestamped}
        disabled={loadingTs}
        aria-label="Copy the timestamped transcript the model receives"
      >
        <StateIcon state={tsState} base={<Clock size={15} />} loading={loadingTs} />
        Copy with timestamps
      </Button>
      <span aria-live="polite" className="sr-only">
        {live}
      </span>
    </div>
  )
}
