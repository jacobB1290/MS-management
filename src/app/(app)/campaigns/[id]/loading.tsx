import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageHeader
          eyebrow="Campaign"
          title={<Skeleton className="h-7 w-56" />}
          backHref="/campaigns"
          backLabel="All campaigns"
        />
      }
    >
      <LoadingView className="pt-6">
        <FormSkeleton fields={6} />
      </LoadingView>
    </PageScaffold>
  )
}
