import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <LoadingView className="flex h-full min-h-0 flex-col">
      {/* Header block — mirrors the detail page's paddings + max-width */}
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-3xl w-full mx-auto">
        <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-x-[var(--space-sm)]">
          {/* Back button ghost */}
          <div className="flex justify-start">
            <Skeleton className="h-11 w-11 shrink-0 rounded-pill" />
          </div>
          {/* Name title ghost */}
          <Skeleton className="h-6 w-48" />
          <span aria-hidden />
        </div>
        {/* Quick action circles ghost */}
        <div className="mt-5 flex items-start justify-center gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-11 w-11 rounded-pill" />
              <Skeleton className="h-3 w-8" />
            </div>
          ))}
        </div>
      </div>
      {/* Scrollable body ghost */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-8 max-w-3xl w-full mx-auto">
        <FormSkeleton fields={5} />
      </div>
    </LoadingView>
  )
}
