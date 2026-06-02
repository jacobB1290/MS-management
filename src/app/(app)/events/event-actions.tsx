"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ExternalLink, Loader2, MoreHorizontal, Sparkles, Trash2, Upload, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

const PUBLIC_EVENTS_URL = "https://ms.church/outreach#events"

interface EventActionsProps {
  id: string
  status: "draft" | "published" | "cancelled"
  isAdmin: boolean
}

export function EventActions({ id, status, isAdmin }: EventActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | "publish" | "cancel" | "delete">(null)

  async function publish() {
    setBusy("publish")
    try {
      const res = await fetch(`/api/events/${id}/publish`, { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Publish failed: ${json?.error ?? res.status}`)
        return
      }
      toast.success(
        json?.mock
          ? "Marked published (Google not connected — connect it to go live)."
          : "Published. Live on ms.church within ~5 minutes.",
      )
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function unpublish() {
    setBusy("cancel")
    try {
      const res = await fetch(`/api/events/${id}/publish?action=cancel`, { method: "POST" })
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

  async function remove() {
    if (!confirm("Delete this event everywhere, including the public calendar? This can’t be undone.")) {
      return
    }
    setBusy("delete")
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Delete failed: ${json?.error ?? res.status}`)
        return
      }
      toast.success("Event deleted.")
      router.push("/events")
    } finally {
      setBusy(null)
    }
  }

  const published = status === "published"
  // Two actions stay visible everywhere — Promote, and the lifecycle primary
  // (Publish while unpublished). The rarer/secondary actions (View, Unpublish,
  // Delete) move into an overflow menu so the row never wraps into a pile on a
  // phone. Consistent across breakpoints, so nothing jumps when you resize.
  const hasOverflow = published || isAdmin

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="secondary" size="sm">
        <Link href={`/campaigns/new?event=${id}&ai=1`}>
          <Sparkles size={15} />
          Promote
        </Link>
      </Button>

      {!published && (
        <Button size="sm" onClick={publish} disabled={busy !== null}>
          {busy === "publish" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          <span className="sm:hidden">Publish</span>
          <span className="hidden sm:inline">Publish to ms.church</span>
        </Button>
      )}

      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="px-2.5" aria-label="More actions">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={18} />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {published && (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    window.open(PUBLIC_EVENTS_URL, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={15} />
                  View on site
                </DropdownMenuItem>
                <DropdownMenuItem onClick={unpublish} closeOnSelect={false} disabled={busy !== null}>
                  <EyeOff size={15} />
                  Unpublish
                </DropdownMenuItem>
              </>
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
      )}
    </div>
  )
}
