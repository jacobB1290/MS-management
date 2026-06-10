import { Skeleton } from "./skeleton"
import { cn } from "@/lib/utils"

/**
 * Shared ghosts for the route-level loading states. Every `loading.tsx`
 * composes these (plus the page's REAL masthead, which is static chrome) so a
 * navigation paints the destination's true frame instantly and only the data
 * region shimmers. One library so the skeleton language — pulse, radius,
 * density — is identical on every screen.
 *
 * `LoadingView` is the required wrapper: it fades the ghost in (a skeleton that
 * snaps in is itself a hard cut) and carries aria-busy for assistive tech.
 */
export function LoadingView({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "animate-[fade-in_var(--motion-fast)_var(--ease-standard)_backwards]",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Avatar + two-line rows — the contacts directory / conversation list shape. */
export function ListRowsSkeleton({
  rows = 8,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-pill" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40 max-w-[60%]" />
            <Skeleton className="h-3 w-56 max-w-[80%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The standard TableCard shape: header band + striped rows. */
export function TableSkeleton({
  rows = 8,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-ink-hairline bg-white",
        className,
      )}
    >
      <div className="flex items-center gap-8 border-b border-ink-hairline px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="hidden h-3 w-16 md:block" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="hidden h-3 w-20 lg:block" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-8 border-b border-ink-hairline px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="h-4 w-44 max-w-[40%]" />
          <Skeleton className="hidden h-4 w-14 md:block" />
          <Skeleton className="h-5 w-16 rounded-pill" />
          <Skeleton className="hidden h-4 w-24 lg:block" />
        </div>
      ))}
    </div>
  )
}

/** The events grid: a wide feature card then a row of poster cards. */
export function CardGridSkeleton({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex overflow-hidden rounded-2xl border border-ink-hairline bg-white">
        <Skeleton className="aspect-[4/5] w-28 shrink-0 rounded-none sm:aspect-auto sm:w-44 md:w-56" />
        <div className="flex flex-1 flex-col justify-center gap-2 p-4 sm:p-6 md:p-8">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-5 w-56 max-w-[80%]" />
          <Skeleton className="h-4 w-44 max-w-[60%]" />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-ink-hairline bg-white"
          >
            <Skeleton className="aspect-[4/5] w-full rounded-none" />
            <div className="space-y-1.5 p-3">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A quiet editor/detail ghost: labelled fields in a readable column. */
export function FormSkeleton({
  fields = 5,
  className,
}: {
  fields?: number
  className?: string
}) {
  return (
    <div className={cn("max-w-2xl space-y-7 pt-6", className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}
