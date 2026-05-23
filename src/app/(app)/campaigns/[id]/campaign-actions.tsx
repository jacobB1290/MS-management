"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { Tables } from "@/lib/database.types"

export function CampaignActions({ campaign }: { campaign: Tables<"campaigns"> }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)

  async function start() {
    if (
      !confirm(
        `Start sending "${campaign.name}" now? Opted-out and unsubscribed contacts will be skipped and recorded.`,
      )
    )
      return
    setWorking(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        toast.error(`Start failed: ${json.error ?? res.status}`)
      } else {
        toast.success(
          `Started. ${json.queued} queued, ${json.skipped_opt_out + json.skipped_unsubscribed + json.skipped_no_channel} skipped.`,
        )
        router.refresh()
      }
    } finally {
      setWorking(false)
    }
  }

  async function cancel() {
    if (!confirm(`Cancel "${campaign.name}"? Already-sent messages aren't recalled.`)) return
    setWorking(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/cancel`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Cancel failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Cancelled.")
        router.refresh()
      }
    } finally {
      setWorking(false)
    }
  }

  if (campaign.status === "draft" || campaign.status === "scheduled") {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={cancel} disabled={working}>
          Cancel
        </Button>
        <Button size="md" onClick={start} disabled={working}>
          {working ? "Starting…" : "Start sending"}
        </Button>
      </div>
    )
  }

  if (campaign.status === "sending") {
    return (
      <Button variant="secondary" size="md" onClick={cancel} disabled={working}>
        {working ? "Cancelling…" : "Cancel send"}
      </Button>
    )
  }

  return null
}
