import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Mail, MessageSquare } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
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

  const { data: event } = await supabase.from("events").select("*").eq("id", id).maybeSingle()
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
  const timeStr = eventDisplayTime(event.starts_at, event.ends_at, event.all_day)
  const when = `${eventLongDate(event.starts_at)}${timeStr ? ` · ${timeStr}` : ""}`

  return (
    <PageScaffold
      header={
        <>
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
            {linkedCampaigns && linkedCampaigns.length > 0 && (
              <span className="ml-1 flex flex-wrap items-center gap-1.5">
                <span className="text-micro text-ink-faint">·</span>
                {linkedCampaigns.map((c) => (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}`}
                    prefetch
                    className="inline-flex items-center gap-1 rounded-pill border border-ink-hairline bg-white px-2 py-0.5 text-micro text-ink-muted transition-colors hover:bg-surface motion-reduce:transition-none"
                  >
                    {c.channel === "sms" ? <MessageSquare size={11} /> : <Mail size={11} />}
                    {c.name}
                  </Link>
                ))}
              </span>
            )}
          </div>
        </>
      }
    >
      <div className="pt-6">
        <EventForm mode="edit" initial={initial} />
      </div>
    </PageScaffold>
  )
}
