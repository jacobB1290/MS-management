"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { ExternalLink, EyeOff, Loader2, MoreHorizontal, RefreshCw, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

interface SermonActionsProps {
  id: string
  youtubeVideoId: string
  status: string
  ready: boolean
  isAdmin: boolean
}

/**
 * Detail-page controls. The primary verb adapts to state: Publish when a
 * reviewed sermon is ready, otherwise Run again to make progress; published
 * sermons keep only the overflow (Unpublish / Watch / Run again / Delete). Same
 * busy-state + toast + router.refresh pattern as the events actions.
 */
export function SermonActions({ id, youtubeVideoId, status, ready, isAdmin }: SermonActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | "publish" | "unpublish" | "run" | "delete">(null)
  const published = status === "published"

  async function publish() {
    setBusy("publish")
    try {
      const res = await fetch(`/api/sermons/${id}/publish`, { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          json?.error === "not_ready"
            ? "Not ready yet — run the pipeline so it has chapters first."
            : `Publish failed: ${json?.error ?? res.status}`,
        )
        return
      }
      toast.success("Published. Live on ms.church within ~5 minutes.")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function unpublish() {
    setBusy("unpublish")
    try {
      const res = await fetch(`/api/sermons/${id}/publish?action=unpublish`, { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Couldn’t unpublish: ${json?.error ?? res.status}`)
        return
      }
      toast.success("Unpublished — removed from ms.church.")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function runAgain() {
    setBusy("run")
    try {
      const res = await fetch("/api/sermons/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: youtubeVideoId, force: true }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const detail = String(json?.detail ?? json?.error ?? res.status).replace(/_/g, " ")
        toast.error(`Run failed: ${detail}`)
        router.refresh()
        return
      }
      toast.success("Reprocessed — review the updated chapters.")
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirm("Delete this sermon from the CRM? The YouTube video is not affected.")) return
    setBusy("delete")
    try {
      const res = await fetch(`/api/sermons/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Delete failed: ${json?.error ?? res.status}`)
        return
      }
      toast.success("Sermon deleted.")
      router.push("/sermons")
    } finally {
      setBusy(null)
    }
  }

  // The primary verb adapts to state; key it so a state change (e.g. after a run
  // lands the sermon at "review") crossfades the new verb in instead of hard-cutting.
  const primary = published
    ? null
    : ready
      ? {
          key: "publish",
          node: (
            <Button size="sm" onClick={publish} disabled={busy !== null}>
              {busy === "publish" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Upload size={15} />
              )}
              <span>Publish</span>
            </Button>
          ),
        }
      : {
          key: "run",
          node: (
            <Button size="sm" onClick={runAgain} disabled={busy !== null}>
              {busy === "run" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              <span>Run pipeline</span>
            </Button>
          ),
        }

  return (
    <div className="flex items-center gap-2">
      {primary && (
        <span
          key={primary.key}
          className="inline-flex animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)] motion-reduce:animate-none"
        >
          {primary.node}
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="px-2.5" aria-label="More actions">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={18} />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              window.open(
                `https://youtu.be/${youtubeVideoId}`,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            <ExternalLink size={15} />
            Watch on YouTube
          </DropdownMenuItem>
          {(ready || published) && (
            <DropdownMenuItem onClick={runAgain} closeOnSelect={false} disabled={busy !== null}>
              <RefreshCw size={15} />
              Run again
            </DropdownMenuItem>
          )}
          {published && (
            <DropdownMenuItem onClick={unpublish} closeOnSelect={false} disabled={busy !== null}>
              <EyeOff size={15} />
              Unpublish
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem
              destructive
              onClick={remove}
              closeOnSelect={false}
              disabled={busy !== null}
            >
              <Trash2 size={15} />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
