import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold
      eyebrow="Edit service"
      title={<Skeleton className="h-7 w-64" />}
      backHref="#"
      backLabel="Back to service"
      meta={<Skeleton className="h-5 w-24" />}
      className="pb-0 md:pb-0"
    >
      <LoadingView className="pt-6">
        <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(360px,30vw,460px)] xl:gap-[var(--space-xl)]">
          <div className="w-full min-w-0 max-w-[760px] space-y-[var(--space-2xl)] xl:mx-auto">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-9 w-2/3" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
              <Skeleton className="h-20 w-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))}
            </div>
          </div>
          <div className="hidden xl:block">
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </LoadingView>
    </DetailScaffold>
  )
}
