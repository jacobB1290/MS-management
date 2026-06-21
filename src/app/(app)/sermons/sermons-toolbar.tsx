"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

/**
 * "Run now" for the Sermons monitor header — triggers the same pipeline the
 * weekly cron runs, against the newest service video. Surfaces the outcome
 * (new chapters, a clean no-op when the latest is already processed, or the
 * failing step) as a toast, then refreshes so the new run row animates in.
 */
export function SermonsToolbar() {
  const router = useRouter()
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      const res = await fetch("/api/sermons/run", { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const detail = json?.detail ?? json?.error ?? res.status
        if (detail === "youtube_caption_access_unconfigured") {
          toast.error("YouTube captions aren’t connected yet — see the setup runbook.")
        } else if (detail === "segment_disabled") {
          toast.error("Transcript saved, but AI segmentation is off (no Anthropic key).")
        } else if (detail === "no_video_in_feed") {
          toast.error("Couldn’t reach the YouTube feed. Try again shortly.")
        } else {
          toast.error(`Run failed at ${String(detail).replace(/_/g, " ")}.`)
        }
        router.refresh()
        return
      }
      if (json?.noop) {
        toast.info("Up to date — the latest service is already processed.")
      } else {
        toast.success("Sermon ready for review.")
      }
      router.refresh()
    } finally {
      setRunning(false)
    }
  }

  return (
    <Button onClick={run} disabled={running} aria-label="Run the pipeline on the latest service">
      {running ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <Play size={16} />
      )}
      <span>{running ? "Running…" : "Run now"}</span>
    </Button>
  )
}
