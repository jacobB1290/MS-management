import type { Metadata } from "next"
import Link from "next/link"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { eventDisplayDate, eventLongDate, eventDisplayTime } from "@/lib/event-format"
import { EventsToolbar } from "./events-toolbar"
import { FlyerImage } from "./flyer-image"

export const metadata: Metadata = { title: "Events" }

type EventRow = {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  status: string
  image_public_url: string | null
}

const STATUS_VARIANT = {
  draft: "muted",
  published: "success",
  cancelled: "warning",
} as const

export default async function EventsPage() {
  await requireStaff()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, all_day, status, image_public_url")
    .order("starts_at", { ascending: false })
    .limit(300)

  const { upcoming, past } = partitionEvents((data ?? []) as EventRow[])

  return (
    <PageScaffold
      header={
        <div className="flex items-center justify-end gap-3 border-b border-ink-hairline pb-4 md:items-start md:justify-between md:pb-5">
          {/* Shared masthead (hidden below md, where the topbar already titles
              the page); the toolbar stays top-right, in the same corner as the
              other tabs' + button. */}
          <PageMasthead
            title="Events"
            description="What’s on at Morning Star, and what’s live on the public site."
          />
          <EventsToolbar />
        </div>
      }
    >
      {upcoming.length === 0 && past.length === 0 ? (
        <div className="py-12">
          <EmptyState
            title="No events yet"
            body="Create an event and publish it to show it on ms.church. Already keep events in Google Calendar? Tap Sync to pull them in."
          />
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section aria-label="Upcoming" className="pt-6">
              <SectionHeading>Upcoming</SectionHeading>
              <FeatureEventCard event={upcoming[0]} />
              {upcoming.length > 1 && (
                <div className="mt-4 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                  {upcoming.slice(1).map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              )}
            </section>
          )}

          {past.length > 0 && (
            <section aria-label="Past" className="mt-12 border-t border-ink-hairline pt-6">
              <SectionHeading>Past</SectionHeading>
              <div className="grid gap-3 opacity-90 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                {past.map((e) => (
                  <EventCard key={e.id} event={e} compact />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </PageScaffold>
  )
}

/** Upcoming (future, soonest first) vs past. Kept out of render for purity. */
function partitionEvents(rows: EventRow[]): { upcoming: EventRow[]; past: EventRow[] } {
  const now = Date.now()
  const upcoming = rows
    .filter((e) => new Date(e.starts_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const past = rows.filter((e) => new Date(e.starts_at).getTime() < now)
  return { upcoming, past }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="font-display text-lead font-medium text-ink">{children}</h2>
      <span className="h-px flex-1 bg-ink-hairline" />
    </div>
  )
}

/** The soonest upcoming event, given a wide editorial treatment. */
function FeatureEventCard({ event }: { event: EventRow }) {
  const time = eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
  const status = event.status as keyof typeof STATUS_VARIANT
  return (
    <Link
      href={`/events/${event.id}`}
      prefetch
      className="group flex overflow-hidden rounded-2xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] hover:shadow-md motion-reduce:transition-none"
    >
      {/* A portrait flyer thumb on mobile (so the hero card stays ~180px tall,
          not a half-screen block), opening up to the full editorial panel on
          sm+. */}
      <div className="relative aspect-[4/5] w-28 shrink-0 overflow-hidden bg-surface sm:aspect-auto sm:w-44 md:w-56">
        <FlyerImage url={event.image_public_url} alt={event.title} iconSize={36} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1 p-4 sm:gap-1.5 sm:p-6 md:p-8">
        <span className="eyebrow text-gold">Next up</span>
        <span className="font-display text-title leading-[0.95] text-gold sm:text-hero">
          {eventDisplayDate(event.starts_at)}
        </span>
        <h3 className="font-display text-lead text-ink sm:text-heading">{event.title}</h3>
        <p className="text-small text-ink-muted">
          {eventLongDate(event.starts_at)}
          {time ? ` · ${time}` : ""}
        </p>
        {status !== "published" && (
          <span className="mt-1">
            <Badge variant={STATUS_VARIANT[status] ?? "muted"}>
              {status}
            </Badge>
          </span>
        )}
      </div>
    </Link>
  )
}

function EventCard({ event, compact = false }: { event: EventRow; compact?: boolean }) {
  const time = eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
  const status = event.status as keyof typeof STATUS_VARIANT
  return (
    <Link
      href={`/events/${event.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] hover:shadow-md motion-reduce:transition-none"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-surface">
        <FlyerImage url={event.image_public_url} alt={event.title} className="group-hover:scale-[1.03]" />
        {status !== "published" && (
          <span className="absolute left-2 top-2">
            <Badge variant={STATUS_VARIANT[status] ?? "muted"} className="shadow-sm">
              {status}
            </Badge>
          </span>
        )}
      </div>
      <div className={cnPad(compact)}>
        <span className="font-display text-base leading-none text-gold">
          {eventDisplayDate(event.starts_at)}
        </span>
        <span className="truncate text-small font-medium text-ink">{event.title}</span>
        {time && !compact && <span className="text-micro text-ink-faint">{time}</span>}
      </div>
    </Link>
  )
}

function cnPad(compact: boolean): string {
  return compact
    ? "flex flex-1 flex-col gap-0.5 p-2.5"
    : "flex flex-1 flex-col gap-0.5 p-3"
}
