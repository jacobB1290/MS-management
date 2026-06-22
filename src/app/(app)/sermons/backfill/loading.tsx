import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold title="Process past services" backHref="/sermons" backLabel="Sermons">
      <LoadingView className="pt-6">
        <Skeleton className="h-[88px] w-full rounded-2xl" />
        <div className="mt-6 flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-pill" />
          ))}
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl border border-ink-hairline bg-white p-3"
            >
              <Skeleton className="aspect-video w-28 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-6 w-6 rounded-pill" />
            </div>
          ))}
        </div>
      </LoadingView>
    </DetailScaffold>
  )
}
