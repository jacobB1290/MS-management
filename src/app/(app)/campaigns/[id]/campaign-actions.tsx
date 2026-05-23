"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { Tables } from "@/lib/database.types"

export function CampaignActions({
  campaign,
  audienceCount,
}: {
  campaign: Tables<"campaigns">
  audienceCount?: number | null
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [confirmStart, setConfirmStart] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  async function start() {
    setWorking(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        toast.error(`Start failed: ${json.error ?? res.status}`)
      } else {
        toast.success(
          `Started — ${json.queued} queued, ${json.skipped_opt_out + json.skipped_unsubscribed + json.skipped_no_channel} skipped`,
        )
        router.refresh()
      }
    } finally {
      setWorking(false)
      setConfirmStart(false)
    }
  }

  async function cancel() {
    setWorking(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/cancel`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Cancel failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Cancelled")
        router.refresh()
      }
    } finally {
      setWorking(false)
      setConfirmCancel(false)
    }
  }

  const audienceLine =
    typeof audienceCount === "number"
      ? `This matches ${audienceCount} contact${audienceCount === 1 ? "" : "s"}. `
      : ""

  return (
    <>
      {(campaign.status === "draft" || campaign.status === "scheduled") && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)} disabled={working}>
            Cancel
          </Button>
          <Button size="md" onClick={() => setConfirmStart(true)} disabled={working}>
            {working ? "Starting…" : "Start sending"}
          </Button>
        </div>
      )}

      {campaign.status === "sending" && (
        <Button variant="secondary" size="md" onClick={() => setConfirmCancel(true)} disabled={working}>
          {working ? "Cancelling…" : "Cancel send"}
        </Button>
      )}

      <ConfirmDialog
        open={confirmStart}
        onOpenChange={setConfirmStart}
        title={`Send “${campaign.name}” now?`}
        description={`${audienceLine}Opted-out and unsubscribed contacts are skipped automatically and recorded in the breakdown.`}
        confirmLabel="Start sending"
        loading={working}
        onConfirm={start}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel “${campaign.name}”?`}
        description="Messages already sent can’t be recalled. Remaining recipients will not be sent to."
        confirmLabel="Cancel campaign"
        cancelLabel="Keep campaign"
        destructive
        loading={working}
        onConfirm={cancel}
      />
    </>
  )
}
