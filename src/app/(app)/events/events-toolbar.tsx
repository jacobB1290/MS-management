"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/** Sync-from-calendar + New-event controls for the events list header. */
export function EventsToolbar() {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/events/sync", { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Sync failed: ${json?.error ?? res.status}`)
        return
      }
      if (json?.mock) {
        toast.info("Google Calendar isn’t connected yet — nothing to sync.")
      } else {
        toast.success(
          `Synced — ${json.imported} new, ${json.updated} updated${
            json.cancelled ? `, ${json.cancelled} removed` : ""
          }.`,
        )
      }
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        aria-label="Sync from Google Calendar"
        title="Sync from Google Calendar"
        className={cn(
          // A quiet 44px circle at every size — the header speaks one circle
          // language (filter / compose / + are all 44px rounds), so a labelled
          // pill beside the + read as a different system. The title attribute
          // and toast carry the wording.
          "inline-flex h-11 w-11 items-center justify-center rounded-pill border border-ink-hairline bg-white text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface hover:text-ink disabled:opacity-50 motion-reduce:transition-none",
        )}
      >
        <RefreshCw size={18} className={cn(syncing && "animate-spin")} />
      </button>
      <Link href="/events/new" aria-label="New event" className="btn-icon-action">
        <Plus size={20} strokeWidth={2.5} />
      </Link>
    </div>
  )
}
