import { Skeleton } from "@/components/ui/skeleton"
import { MobileCollapsingHeader } from "@/components/ui/collapsing-header"
import { LoadingView, FormSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  // Quick-action ghosts (soft circles) — shared by both layouts, like the page.
  const quickActionsGhost = (
    <div className="flex items-start justify-center gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <Skeleton className="h-[52px] w-[52px] rounded-pill" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  )

  return (
    <LoadingView className="flex h-full min-h-0 flex-col">
      {/* DESKTOP header band ghost — md+ only; mobile uses the collapsing ghost. */}
      <div className="hidden md:block shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-3xl w-full mx-auto">
        <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-x-[var(--space-sm)]">
          <div className="flex justify-start">
            <Skeleton className="h-11 w-11 shrink-0 rounded-pill" />
          </div>
          <Skeleton className="h-6 w-48 justify-self-center" />
          <span aria-hidden />
        </div>
        <div className="mt-5">{quickActionsGhost}</div>
      </div>

      {/* Scroll region — the mobile collapsing ghost rides at its top, body below. */}
      <div
        data-scroll-region
        className="flex-1 min-h-0 overflow-hidden px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full mx-auto"
      >
        <MobileCollapsingHeader
          title={<Skeleton className="h-7 w-44" />}
          backHref="/contacts"
          backLabel="All contacts"
          heroExtra={quickActionsGhost}
        />
        <div className="space-y-6">
          <FormSkeleton fields={5} />
        </div>
      </div>
    </LoadingView>
  )
}
