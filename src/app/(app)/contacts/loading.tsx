import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { PAGE_GUTTER } from "@/components/ui/page-scaffold"
import { PageMasthead } from "@/components/ui/page-masthead"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingView, ListRowsSkeleton } from "@/components/ui/loading-blocks"

export default function Loading() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn("shrink-0 pt-4 md:pt-5 bg-bg", PAGE_GUTTER)}>
        <PageMasthead
          title="Contacts"
          description="Everyone the church talks to, in one directory."
          toolbar={
            // Mirrors the real search row: tag-filter circle + search pill.
            <div className="flex items-center gap-2">
              <Skeleton className="h-11 w-11 shrink-0 rounded-pill" />
              <Skeleton className="h-11 flex-1 rounded-pill" />
            </div>
          }
          actions={
            <span className="btn-icon-action opacity-60" aria-hidden>
              <Plus size={20} strokeWidth={2.5} />
            </span>
          }
        />
      </div>
      <LoadingView className={cn("flex-1 min-h-0 overflow-hidden", PAGE_GUTTER)}>
        <ListRowsSkeleton rows={12} />
      </LoadingView>
    </div>
  )
}
