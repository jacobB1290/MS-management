import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { EventForm } from "../event-form"

export const metadata: Metadata = { title: "New event" }

export default async function NewEventPage() {
  await requireStaff()

  return (
    <DetailScaffold
      title="New event"
      backHref="/events"
      backLabel="All events"
      info="Create an event here, then publish it to the church Google Calendar — ms.church reads that calendar and shows the event automatically. The flyer image is what appears on the site."
      // The editor closes with a sticky EditorBar; the scaffold's bottom
      // padding would otherwise show as a cream gap beneath it at scroll end.
      className="pb-0 md:pb-0"
    >
      <div className="pt-6">
        <EventForm mode="create" />
      </div>
    </DetailScaffold>
  )
}
