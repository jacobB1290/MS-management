import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionHeading } from "@/components/ui/section-heading"
import { LoadingView } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold
      eyebrow="Sermon"
      title={<Skeleton className="h-7 w-64" />}
      backHref="/sermons"
      backLabel="All sermons"
      meta={<Skeleton className="h-5 w-72" />}
    >
      <LoadingView className="space-y-12 pt-6">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,300px)_1fr] sm:gap-6">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full max-w-prose" />
            <Skeleton className="h-4 w-5/6 max-w-prose" />
            <Skeleton className="h-4 w-3/4 max-w-prose" />
          </div>
        </div>
        <div>
          <SectionHeading>Chapters</SectionHeading>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4 rounded-xl border border-ink-hairline bg-white p-4">
                <Skeleton className="h-6 w-12 rounded-pill" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </LoadingView>
    </DetailScaffold>
  )
}
