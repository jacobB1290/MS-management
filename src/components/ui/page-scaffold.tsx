import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The single page frame for every non-inbox screen. It owns the ONE scroll
 * region — full-bleed, so the scrollbar sits at the screen edge (just inside the
 * sidebar), never stranded mid-canvas behind a centered column. Content fills
 * the width with comfortable, viewport-scaled side gutters; there is no
 * page-level max-width. Any reading measure belongs on an inner region, not here.
 *
 * Pages compose their own header (PageHeader + optional sub-row) and pass it in;
 * the body is whatever bespoke grid the page wants. Because the scaffold owns
 * `overflow-y-auto`, pages must NOT add their own — that keeps sticky panes and
 * scroll behaviour predictable and kills the floating-scrollbar bug at the root.
 */
export interface PageScaffoldProps {
  header: React.ReactNode
  children: React.ReactNode
  /** Extra full-bleed band under the header (e.g. a sub-nav or status strip). */
  headerBand?: React.ReactNode
  /** Ref to the scroll element, for scroll-restoration / sticky-shadow hooks. */
  scrollRef?: React.Ref<HTMLDivElement>
  className?: string
}

// Side gutters that grow with the viewport — full width on a laptop, a little
// more air on a wide monitor — without ever capping the content into a column.
// Exported (with the matching negative-margin bleed) so full-bleed strips
// inside the scroll region — e.g. the sticky EditorBar — can escape and
// re-enter the same gutters without hardcoding a second copy that drifts.
export const PAGE_GUTTER = "px-4 md:px-8 xl:px-12 2xl:px-16"
export const PAGE_GUTTER_BLEED = "-mx-4 md:-mx-8 xl:-mx-12 2xl:-mx-16"
const GUTTER = PAGE_GUTTER

export function PageScaffold({
  header,
  children,
  headerBand,
  scrollRef,
  className,
}: PageScaffoldProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 bg-bg">
        {/* pt matches the compact masthead rhythm — chrome stays tight so the
            content owns the screen (same value the contacts header uses). */}
        <div className={cn(GUTTER, "pt-4 md:pt-5")}>{header}</div>
        {headerBand}
      </div>
      <div
        ref={scrollRef}
        // Stable hook for descendants that need to drive this one scroll region
        // (e.g. Settings resets it to the top when you switch panes) without
        // coupling to a Tailwind class name.
        data-scroll-region
        className={cn(
          "flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
          GUTTER,
          "pb-8 md:pb-10",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
