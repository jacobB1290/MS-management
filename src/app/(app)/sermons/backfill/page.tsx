import type { Metadata } from "next"
import { History } from "lucide-react"
import { requireStaff } from "@/server/auth"
import { isAiEnabled } from "@/server/ai/client"
import { hasCaptionAccess } from "@/server/youtube/captions"
import { listBackfillCandidates } from "@/server/sermons/backfill"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { EmptyState } from "@/components/ui/empty-state"
import { BackfillPicker } from "./backfill-picker"

export const metadata: Metadata = { title: "Process past services" }

// The playlist read + cross-reference is live data; never cache the page shell.
export const dynamic = "force-dynamic"

/**
 * "Process past services" — the back-catalog backfill picker. Staff select past
 * service livestreams; each is queued and a pg_cron worker processes them
 * server-side (no CRM instance needed). Processed services land in review here
 * for a bulk publish to ms.church.
 */
export default async function SermonBackfillPage() {
  await requireStaff()
  const listing = await listBackfillCandidates()
  const captionsReady = hasCaptionAccess()
  const aiReady = isAiEnabled()

  return (
    <DetailScaffold
      title="Process past services"
      backHref="/sermons"
      backLabel="Sermons"
    >
      <div className="pt-6">
        {!listing.configured ? (
          <EmptyState
            icon={<History size={26} />}
            title="No past services found"
            body={
              captionsReady
                ? "We couldn’t reach the YouTube playlist. Confirm the service uploads playlist is public and the YouTube API access is configured, then reload."
                : "Connect YouTube access first — the back catalog is read from the church’s service uploads playlist. Setup steps: docs/sermons-youtube-setup-runbook.md."
            }
          />
        ) : (
          <BackfillPicker
            initial={listing}
            captionsReady={captionsReady}
            aiReady={aiReady}
          />
        )}
      </div>
    </DetailScaffold>
  )
}
