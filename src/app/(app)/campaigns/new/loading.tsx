import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageHeader
          title="New campaign"
          backHref="/campaigns"
          backLabel="All campaigns"
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
