import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Event"
          title={<Skeleton className="h-7 w-56" />}
          backHref="/events"
          backLabel="All events"
          meta={<Skeleton className="h-5 w-64" />}
        />
      }
      className="pb-0 md:pb-0"
    >
      <LoadingView className="pt-6">
        <FormSkeleton fields={6} />
      </LoadingView>
    </PageScaffold>
  )
}
