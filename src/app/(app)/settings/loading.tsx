import { PageHeader } from "@/components/ui/page-header"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { BackButton } from "@/components/ui/back-button"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <PageScaffold
      header={
        <PageHeader
          title="Settings"
          backSlot={<BackButton label="Back" />}
          backMobileOnly
        />
      }
    >
      <LoadingView className="flex gap-8 pt-4">
        {/* Rail of section nav ghosts — desktop only */}
        <div className="hidden md:flex md:w-60 shrink-0 flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
        {/* Main pane ghost */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Mobile: show the same list ghosts full-width */}
          <div className="flex flex-col gap-2 md:hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
          {/* Desktop: a card-shaped content ghost */}
          <Skeleton className="hidden h-40 w-full rounded-lg md:block" />
        </div>
      </LoadingView>
    </PageScaffold>
  )
}
