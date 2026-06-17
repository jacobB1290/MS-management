import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold
      title="New campaign"
      backHref="/campaigns"
      backLabel="All campaigns"
      className="pb-0 md:pb-0"
    >
      <LoadingView className="pt-6">
        <FormSkeleton fields={6} />
      </LoadingView>
    </DetailScaffold>
  )
}
