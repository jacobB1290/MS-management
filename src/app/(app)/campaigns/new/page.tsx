import type { Metadata } from "next"
import { Suspense } from "react"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { eventLongDate, eventDisplayTime } from "@/lib/event-format"
import { CampaignComposer, type ComposerPrefill } from "./campaign-composer"

export const metadata: Metadata = { title: "New campaign" }

interface NewCampaignPageProps {
  searchParams: Promise<{ event?: string; channel?: string }>
}

export default async function NewCampaignPage({ searchParams }: NewCampaignPageProps) {
  // Shell paints immediately on nav; the composer (which needs the tag
  // vocabulary, and the event when promoting) streams in behind a skeleton.
  await requireStaff()
  const { event, channel } = await searchParams

  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Outreach"
          title="New campaign"
          backHref="/campaigns"
          backLabel="All campaigns"
          info="Compose a one-off SMS or email blast. Opted-out and unsubscribed contacts are automatically excluded; the recipient list records who was skipped and why."
        />
      }
    >
      <div className="pt-6">
        <Suspense fallback={<ComposerSkeleton />}>
          <CampaignComposerLoader eventId={event} channel={channel} />
        </Suspense>
      </div>
    </PageScaffold>
  )
}

async function CampaignComposerLoader({
  eventId,
  channel,
}: {
  eventId?: string
  channel?: string
}) {
  const supabase = await createSupabaseServerClient()
  const [tagList, eventRes] = await Promise.all([
    getContactTagOccurrences(),
    eventId
      ? supabase
          .from("events")
          .select("id, title, starts_at, ends_at, all_day, cta_url, image_public_url")
          .eq("id", eventId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const tagCounts = new Map<string, number>()
  for (const t of tagList) {
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  }
  const tagOptions = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }))

  const ev = eventRes.data
  const prefill: ComposerPrefill | undefined = ev
    ? {
        channel: channel === "email" ? "email" : "sms",
        name: `Promote: ${ev.title}`,
        body: smsPromoBody(ev),
        mediaUrl: ev.image_public_url,
        subject: ev.title,
        eventId: ev.id,
        eventTitle: ev.title,
      }
    : undefined

  return <CampaignComposer tagOptions={tagOptions} prefill={prefill} />
}

/** A short SMS promo seed from an event: title, when, and a link. */
function smsPromoBody(ev: {
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  cta_url: string | null
}): string {
  const time = eventDisplayTime(ev.starts_at, ev.ends_at, ev.all_day)
  const when = time ? `${eventLongDate(ev.starts_at)} at ${time}` : eventLongDate(ev.starts_at)
  const link = ev.cta_url || "https://ms.church/outreach#events"
  return `${ev.title} — ${when}. ${link}`
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
