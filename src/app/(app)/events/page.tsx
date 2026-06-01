import type { Metadata } from "next"
import Link from "next/link"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { eventDisplayDate, eventDisplayTime } from "@/lib/event-format"
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

  const rows = (data ?? []) as EventRow[]
  const { upcoming, past } = partitionEvents(rows)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-ink-hairline bg-bg px-4 pb-3 pt-4 md:px-8">
        <div className="flex items-center justify-end">
          <EventsToolbar />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 md:px-8 md:pb-8">
        {rows.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="No events yet"
              body="Create an event and publish it to show it on ms.church. Already keep events in Google Calendar? Tap Sync to pull them in."
            />
          </div>
        ) : (
          <>
            {upcoming.length > 0 && <EventSection title="Upcoming" events={upcoming} />}
            {past.length > 0 && <EventSection title="Past" events={past} />}
          </>
        )}
      </div>
    </div>
  )
}

/** Split events into upcoming (start in the future, ascending) and past.
 *  Kept out of the component body so the per-request `Date.now()` read isn't
 *  flagged as impure render. */
function partitionEvents(rows: EventRow[]): { upcoming: EventRow[]; past: EventRow[] } {
  const now = Date.now()
  const upcoming = rows
    .filter((e) => new Date(e.starts_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  const past = rows.filter((e) => new Date(e.starts_at).getTime() < now)
  return { upcoming, past }
}

function EventSection({ title, events }: { title: string; events: EventRow[] }) {
  return (
    <section className="mb-8" aria-label={title}>
      <h2 className="eyebrow mb-3 mt-5">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </section>
  )
}

function EventCard({ event }: { event: EventRow }) {
  const time = eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
  const status = event.status as keyof typeof STATUS_VARIANT
  return (
    <Link
      href={`/events/${event.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] hover:shadow-md motion-reduce:transition-none"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-surface">
        <FlyerImage url={event.image_public_url} alt={event.title} className="group-hover:scale-[1.03]" />
        {status !== "published" && (
          <span className="absolute left-2 top-2">
            <Badge variant={STATUS_VARIANT[status] ?? "muted"} className="capitalize shadow-sm">
              {status}
            </Badge>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="font-display text-base leading-none text-gold">
          {eventDisplayDate(event.starts_at)}
        </span>
        <span className="truncate text-small font-medium text-ink">{event.title}</span>
        {time && <span className="text-micro text-ink-faint">{time}</span>}
      </div>
    </Link>
  )
}
