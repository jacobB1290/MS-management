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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline bg-white px-3 py-1.5 text-small text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface disabled:opacity-50 motion-reduce:transition-none"
      >
        <RefreshCw size={15} className={cn(syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync"}
      </button>
      <Link href="/events/new" aria-label="New event" className="btn-icon-action">
        <Plus size={20} strokeWidth={2.5} />
      </Link>
    </div>
  )
}
