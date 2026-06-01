import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Mail, MessageSquare } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { eventLongDate, eventDisplayTime } from "@/lib/event-format"
import { EventForm, type EventFormInitial } from "../event-form"
import { EventActions } from "../event-actions"

export const metadata: Metadata = { title: "Event" }

const STATUS_VARIANT = {
  draft: "muted",
  published: "success",
  cancelled: "warning",
} as const

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EventDetailPage({ params }: PageProps) {
  const user = await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: event } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!event) notFound()

  const { data: linkedCampaigns } = await supabase
    .from("campaigns")
    .select("id, name, channel, status")
    .eq("event_id", id)
    .order("created_at", { ascending: false })

  const status = event.status as "draft" | "published" | "cancelled"
  const initial: EventFormInitial = {
    id: event.id,
    title: event.title,
    description: event.description,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    all_day: event.all_day,
    location: event.location,
    cta_text: event.cta_text,
    cta_url: event.cta_url,
    image_public_url: event.image_public_url,
    image_storage_path: event.image_storage_path,
  }
  const when = `${eventLongDate(event.starts_at)}${
    eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
      ? ` · ${eventDisplayTime(event.starts_at, event.ends_at, event.all_day)}`
      : ""
  }`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="w-full max-w-5xl shrink-0 bg-bg px-4 pb-4 pt-4 md:px-8 md:pt-6">
        <PageHeader
          eyebrow="Event"
          title={event.title}
          backHref="/events"
          backLabel="All events"
          actions={<EventActions id={event.id} status={status} isAdmin={user.role === "admin"} />}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[status] ?? "muted"} className="capitalize">
            {status}
          </Badge>
          <span className="text-small text-ink-muted">{when}</span>
          {event.source === "gcal" && (
            <span className="text-micro text-ink-faint">· created in Google Calendar</span>
          )}
        </div>
      </div>

      <div className="w-full max-w-5xl flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 md:px-8 md:pb-8">
        {linkedCampaigns && linkedCampaigns.length > 0 && (
          <div className="mb-6 rounded-lg border border-ink-hairline bg-white p-4">
            <p className="eyebrow mb-3">Promotions</p>
            <ul className="space-y-1.5">
              {linkedCampaigns.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    prefetch
                    className="inline-flex items-center gap-2 text-small text-ink hover:underline"
                  >
                    {c.channel === "sms" ? <MessageSquare size={14} /> : <Mail size={14} />}
                    {c.name}
                    <Badge variant="muted" className="ml-1">
                      {c.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <EventForm mode="edit" initial={initial} />
      </div>
    </div>
  )
}
