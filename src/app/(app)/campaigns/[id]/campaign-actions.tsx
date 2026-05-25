"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { Tables } from "@/lib/database.types"
import type { AudienceBreakdown } from "@/server/comms/campaignAudience"

export function CampaignActions({
  campaign,
  audienceBreakdown,
}: {
  campaign: Tables<"campaigns">
  audienceBreakdown?: AudienceBreakdown | null
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
        const skipped =
          (json.skipped_opt_out ?? 0) +
          (json.skipped_unsubscribed ?? 0) +
          (json.skipped_no_channel ?? 0) +
          (json.skipped_no_consent ?? 0)
        toast.success(`Started: ${json.queued} queued, ${skipped} skipped`)
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

  const b = audienceBreakdown
  const noChannelLabel = campaign.channel === "sms" ? "no phone" : "no email"
  const skips: string[] = []
  if (b) {
    if (b.skipped_no_consent > 0) skips.push(`${b.skipped_no_consent} no consent`)
    if (b.skipped_opt_out > 0) skips.push(`${b.skipped_opt_out} opted out`)
    if (b.skipped_unsubscribed > 0) skips.push(`${b.skipped_unsubscribed} unsubscribed`)
    if (b.skipped_no_channel > 0) skips.push(`${b.skipped_no_channel} ${noChannelLabel}`)
  }
  const startDescription = b
    ? `${b.queued} of ${b.total} matched ${b.total === 1 ? "contact" : "contacts"} will be messaged${
        skips.length ? `. Skipped: ${skips.join(", ")}` : ""
      }. Only the eligible group is sent to.`
    : "Opted-out, unsubscribed, and non-consented contacts are skipped automatically and recorded in the breakdown."

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
        description={startDescription}
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
