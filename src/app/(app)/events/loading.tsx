import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { SectionHeading } from "@/components/ui/section-heading"
import { CardGridSkeleton, LoadingView } from "@/components/ui/loading-blocks"
import { EventsToolbar } from "./events-toolbar"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageMasthead
          title="Events"
          description="What’s on at Morning Star, and what’s live on the public site."
          actions={<EventsToolbar />}
        />
      }
    >
      <LoadingView className="pt-6">
        <SectionHeading>Upcoming</SectionHeading>
        <CardGridSkeleton />
      </LoadingView>
    </PageScaffold>
  )
}
