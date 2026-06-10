import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView } from "@/components/ui/loading-blocks"

/**
 * Ghost of the conversation rail while the contact_summary read streams in.
 * Mirrors the real list's sticky header (filter circle · search pill · compose
 * circle) and row anatomy exactly, so the swap to live content is a fade of
 * detail, not a reflow.
 */
export function ConversationListSkeleton() {
  return (
    <LoadingView className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-ink-hairline bg-surface/95 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-11 w-11 shrink-0 rounded-pill" />
          <Skeleton className="h-11 flex-1 rounded-pill" />
          <Skeleton className="h-11 w-11 shrink-0 rounded-pill" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 px-4 py-3.5">
            <span className="w-2 shrink-0" />
            <Skeleton className="h-10 w-10 shrink-0 rounded-pill" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </LoadingView>
  )
}
