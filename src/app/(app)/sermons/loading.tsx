import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { SectionHeading } from "@/components/ui/section-heading"
import { Skeleton } from "@/components/ui/skeleton"
import { CardGridSkeleton, LoadingView, TableSkeleton } from "@/components/ui/loading-blocks"
import { SermonsToolbar } from "./sermons-toolbar"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageMasthead
          title="Sermons"
          description="Sunday services, transcribed and chaptered for ms.church."
          actions={<SermonsToolbar />}
        />
      }
    >
      <LoadingView className="pt-5">
        {/* Status band ghost — pixel-matches the real band: same rounded card and
            the gap-px hairline divider grid, so nothing shifts on swap. */}
        <div className="overflow-hidden rounded-2xl border border-ink-hairline bg-white shadow-sm">
          <div className="grid grid-cols-2 gap-px bg-ink-hairline md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1 bg-white px-4 py-3.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            ))}
          </div>
        </div>

        <div className="pt-8">
          <SectionHeading>Latest</SectionHeading>
          <CardGridSkeleton />
        </div>

        <div className="mt-12 border-t border-ink-hairline pt-6">
          <SectionHeading>Recent activity</SectionHeading>
          <TableSkeleton rows={6} />
        </div>
      </LoadingView>
    </PageScaffold>
  )
}
