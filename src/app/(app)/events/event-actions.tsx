"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ExternalLink, Loader2, Sparkles, Trash2, Upload, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="secondary" size="sm">
        <Link href={`/campaigns/new?event=${id}&ai=1`}>
          <Sparkles size={15} />
          Promote
        </Link>
      </Button>

      {status === "published" ? (
        <>
          <Button asChild variant="secondary" size="sm">
            <a href={PUBLIC_EVENTS_URL} target="_blank" rel="noopener noreferrer">
              View on site
              <ExternalLink size={14} />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={unpublish} disabled={busy !== null}>
            {busy === "cancel" ? <Loader2 size={15} className="animate-spin" /> : <EyeOff size={15} />}
            Unpublish
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={publish} disabled={busy !== null}>
          {busy === "publish" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          Publish to ms.church
        </Button>
      )}

      {isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          onClick={remove}
          disabled={busy !== null}
          className="text-danger hover:bg-danger/10"
        >
          {busy === "delete" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          Delete
        </Button>
      )}
    </div>
  )
}
