import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { EventForm } from "../event-form"

export const metadata: Metadata = { title: "New event" }

export default async function NewEventPage() {
  await requireStaff()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="w-full max-w-6xl mx-auto shrink-0 bg-bg px-4 pb-4 pt-4 md:px-8 md:pt-6">
        <PageHeader
          eyebrow="Events"
          title="New event"
          backHref="/events"
          backLabel="All events"
          info="Create an event here, then publish it to the church Google Calendar — ms.church reads that calendar and shows the event automatically. The flyer image is what appears on the site."
        />
      </div>
      <div className="w-full max-w-6xl mx-auto flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 md:px-8 md:pb-8">
        <EventForm mode="create" />
      </div>
    </div>
  )
}
