import type { Metadata } from "next"
import { Suspense } from "react"
import { requireStaff } from "@/server/auth"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { CampaignComposer } from "./campaign-composer"

export const metadata: Metadata = { title: "New campaign" }

export default async function NewCampaignPage() {
  // Shell paints immediately on nav; the composer (which needs the tag
  // vocabulary) streams in behind a skeleton instead of blocking the page.
  await requireStaff()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-3xl w-full">
        <PageHeader
          eyebrow="Outreach"
          title="New campaign"
          backHref="/campaigns"
          backLabel="All campaigns"
          info="Compose a one-off SMS or email blast. Opted-out and unsubscribed contacts are automatically excluded; the recipient list records who was skipped and why."
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full">
        <div className="rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
          <Suspense fallback={<ComposerSkeleton />}>
            <CampaignComposerLoader />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

async function CampaignComposerLoader() {
  const tagCounts = new Map<string, number>()
  for (const t of await getContactTagOccurrences()) {
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  }
  const tagOptions = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }))

  return <CampaignComposer tagOptions={tagOptions} />
}

function ComposerSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-11 w-32" />
    </div>
  )
}

