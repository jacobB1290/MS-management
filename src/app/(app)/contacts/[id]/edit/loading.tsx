import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold title="Edit contact" backHref="/contacts" backLabel="Back to contact">
      <div className="mx-auto w-full max-w-2xl pt-6">
        <LoadingView>
          <FormSkeleton fields={6} />
        </LoadingView>
      </div>
    </DetailScaffold>
  )
}
