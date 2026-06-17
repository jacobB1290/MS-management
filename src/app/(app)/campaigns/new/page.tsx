import type { Metadata } from "next"
import { Suspense } from "react"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { PreviewPanel } from "@/components/ui/preview-panel"
import { Skeleton } from "@/components/ui/skeleton"
import { eventLongDate, eventDisplayTime } from "@/lib/event-format"
import { CampaignComposer, type ComposerPrefill } from "./campaign-composer"

export const metadata: Metadata = { title: "New campaign" }

interface NewCampaignPageProps {
  searchParams: Promise<{ event?: string; channel?: string; ai?: string }>
}

export default async function NewCampaignPage({ searchParams }: NewCampaignPageProps) {
  // Shell paints immediately on nav; the composer (which needs the tag
  // vocabulary, and the event when promoting) streams in behind a skeleton.
  await requireStaff()
  const { event, channel, ai } = await searchParams

  return (
    <DetailScaffold
      title="New campaign"
      backHref="/campaigns"
      backLabel="All campaigns"
      info="Compose a one-off SMS or email blast. Opted-out and unsubscribed contacts are automatically excluded; the recipient list records who was skipped and why."
      // The composer closes with a sticky EditorBar; the scaffold's bottom
      // padding would otherwise show as a cream gap beneath it at scroll end.
      className="pb-0 md:pb-0"
    >
      <div className="pt-6">
        <Suspense fallback={<ComposerSkeleton />}>
          <CampaignComposerLoader eventId={event} channel={channel} ai={ai === "1" || ai === "true"} />
        </Suspense>
      </div>
    </DetailScaffold>
  )
}

async function CampaignComposerLoader({
  eventId,
  channel,
  ai,
}: {
  eventId?: string
  channel?: string
  ai?: boolean
}) {
  const supabase = await createSupabaseServerClient()
  const [tagList, eventRes, totalRes, membersRes] = await Promise.all([
    getContactTagOccurrences(),
    eventId
      ? supabase
          .from("events")
          .select("id, title, starts_at, ends_at, all_day, cta_url, image_public_url")
          .eq("id", eventId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Head counts only — the audience picker talks in people, not filters.
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("is_member", true),
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
        ai: Boolean(ai),
      }
    : undefined

  return (
    <CampaignComposer
      tagOptions={tagOptions}
      audienceCounts={{ total: totalRes.count ?? 0, members: membersRes.count ?? 0 }}
      prefill={prefill}
    />
  )
}

/** A short SMS promo seed from an event: title, when, and a link. Kept to the
 *  GSM-7 alphabet (plain hyphens, no em/en dashes) — one typographic dash
 *  flips the whole SMS to UCS-2 and doubles the per-text cost. */
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
  return `${ev.title} - ${when}. ${link}`.replace(/[–—]/g, "-")
}

function ComposerSkeleton() {
  // Mirrors the composer's editorial grid so the stream-in doesn't reflow:
  // quiet fields at a reading measure on the left, the recipient-phone
  // preview on the right rail (xl+).
  return (
    <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(340px,27vw,420px)] xl:gap-[var(--space-xl)]">
      <div className="w-full max-w-[680px] space-y-10 xl:mx-auto">
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-12 w-full max-w-[360px] rounded-pill" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-6 w-40" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-32 rounded-pill" />
            <Skeleton className="h-11 w-28 rounded-pill" />
            <Skeleton className="h-11 w-28 rounded-pill" />
          </div>
        </div>
      </div>
      <PreviewPanel>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-4 h-72 w-full max-w-[340px] rounded-xl" />
      </PreviewPanel>
    </div>
  )
}
