import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionHeading } from "@/components/ui/section-heading"
import { LoadingView, TableSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <DetailScaffold
      eyebrow="Campaign"
      title={<Skeleton className="h-7 w-56" />}
      backHref="/campaigns"
      backLabel="All campaigns"
      meta={<Skeleton className="h-5 w-40" />}
    >
      <LoadingView className="space-y-[var(--space-xl)] pt-6">
        {/* Headline + funnel */}
        <div className="space-y-[var(--space-md)]">
          <Skeleton className="h-10 w-44" />
          <Skeleton className="h-2.5 w-full rounded-pill" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>

        <div className="grid gap-[var(--space-xl)] xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-[var(--space-xl)]">
            <div>
              <SectionHeading>Recipients</SectionHeading>
              <div className="mb-4 flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-20 rounded-pill" />
                ))}
              </div>
              <TableSkeleton rows={6} />
            </div>
            <div>
              <SectionHeading>Message</SectionHeading>
              <Skeleton className="h-16 w-full max-w-md" />
            </div>
          </div>
          <div className="space-y-[var(--space-xl)]">
            <div>
              <SectionHeading>Timeline</SectionHeading>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </LoadingView>
    </DetailScaffold>
  )
}
