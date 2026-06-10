import { PageHeader } from "@/components/ui/page-header"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-5 pb-4 bg-bg max-w-2xl w-full mx-auto">
        <PageHeader
          title="Edit contact"
          backHref="/contacts"
          backLabel="Back to contact"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-8 max-w-2xl w-full">
        <LoadingView>
          <FormSkeleton fields={6} />
        </LoadingView>
      </div>
    </div>
  )
}
