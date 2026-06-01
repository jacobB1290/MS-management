import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { EventForm } from "../event-form"

export const metadata: Metadata = { title: "New event" }

export default async function NewEventPage() {
  await requireStaff()

  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Events"
          title="New event"
          backHref="/events"
          backLabel="All events"
          info="Create an event here, then publish it to the church Google Calendar — ms.church reads that calendar and shows the event automatically. The flyer image is what appears on the site."
        />
      }
    >
      <div className="pt-6">
        <EventForm mode="create" />
      </div>
    </PageScaffold>
  )
}
