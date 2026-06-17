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
  /** Mobile iOS collapsing header (a <MobileCollapsingHeader/>). When set, the
   *  pinned `header` band becomes md+ only and this rides at the top of the ONE
   *  scroll region instead — so on phones/tablets the big title scrolls away
   *  under a frosted bar while desktop keeps the static centered header. */
  collapseHeader?: React.ReactNode
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
  collapseHeader,
  scrollRef,
  className,
}: PageScaffoldProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The pinned header band. With a collapseHeader it goes md+ only: on
          mobile the collapsing header (inside the scroll region) takes over, so
          the band must not also occupy the top. Desktop is byte-for-byte as
          before. */}
      <div className={cn("shrink-0 bg-bg", collapseHeader && "hidden md:block")}>
        {/* pt matches the compact masthead rhythm — chrome stays tight so the
            content owns the screen (same value the contacts header uses). */}
        <div className={cn(GUTTER, "pt-4 md:pt-5")}>{header}</div>
        {headerBand}
      </div>
      <div
        ref={scrollRef}
        // Stable hook for descendants that need to drive this one scroll region
        // (e.g. Settings resets it to the top when you switch panes) without
        // coupling to a Tailwind class name. It is also the IntersectionObserver
        // root for the mobile collapsing header below.
        data-scroll-region
        className={cn(
          // overflow-x-hidden is load-bearing, not cosmetic: this element sets
          // overflow-y:auto, and CSS computes the unset overflow-x to `auto`
          // too — so ANY descendant wider than the region (notably iOS Safari's
          // native date/time controls, which spill past their box) turns the
          // whole page into a side-to-side pan. Pinning the cross-axis to hidden
          // makes every detail page "fixed on its spot" no matter what spills.
          // Vertical stays auto, so the sticky collapse bar still pins normally.
          "flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]",
          GUTTER,
          "pb-8 md:pb-10",
          className,
        )}
      >
        {/* First in the scroll flow so its sticky bar pins to the top edge and
            the big-title hero scrolls away under it; md:hidden, so it is inert
            (display:none) on desktop where the band above owns the chrome. */}
        {collapseHeader}
        {children}
      </div>
    </div>
  )
}
