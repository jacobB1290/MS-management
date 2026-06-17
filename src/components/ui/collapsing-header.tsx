"use client"
import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageInfo } from "./page-info"

/**
 * Mobile-only iOS collapsing header. The big page title rides in a HERO at the
 * top of the page's scroll region and scrolls away; a slim BAR stays pinned at
 * the top edge (back · inline title · actions), and as the hero passes under it
 * the inline title cross-fades in while a frosted, progressively-faded pane
 * resolves behind the bar so content dissolves under it (never a hard clip).
 *
 * This renders ONLY below md (`md:hidden`); desktop keeps the static centered
 * PageHeader, rendered separately in the scaffold's pinned band. So a page using
 * the scaffold's `collapseHeader` slot shows this on phones/tablets and the
 * untouched PageHeader on laptops — two layouts, one set of props.
 *
 * State is one `data-collapsed` attribute toggled by the IntersectionObserver
 * below; the visible motion (cross-fade + frost) is all CSS transitions off that
 * attribute (see globals.css §Collapsing header), so it stays on the compositor
 * and reduced-motion lands on the correct end state with no animation.
 *
 * Accessibility: the inline bar title is the page's programmatic heading (it is
 * present from first paint — only its opacity animates — so screen readers reach
 * it before any scroll). The large hero title is the same text repeated for the
 * eye, so it is `aria-hidden`; the desktop PageHeader still owns the real <h1>.
 */

// Slim nav-bar height in px — a 44px tap row plus breath. Kept in sync with
// `--collapse-bar-h` in globals.css; it is also the observer's top inset, so the
// handoff fires exactly as the hero slides under the bar's bottom edge.
const BAR_H = 52

/**
 * Watches a 1px sentinel at the bottom of the hero against the page's scroll
 * region (the nearest `[data-scroll-region]`). `collapsed` flips true only once
 * the sentinel has travelled ABOVE the bar — not when it merely starts below the
 * fold on a tall hero — so a page that does not scroll never collapses, and a
 * page restored mid-scroll paints already-collapsed. Disabled at md+ (the
 * subtree is display:none there and desktop never collapses), and re-armed if
 * the viewport crosses the breakpoint.
 */
function useCollapseOnScroll() {
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const root = sentinel.closest<HTMLElement>("[data-scroll-region]")
    const desktop = window.matchMedia("(min-width: 768px)")
    let observer: IntersectionObserver | null = null

    const arm = () => {
      if (observer || desktop.matches) return
      observer = new IntersectionObserver(
        ([entry]) => {
          const rootTop = entry.rootBounds?.top ?? 0
          // Above the (inset) top edge => scrolled under the bar => collapsed.
          // Below the fold (tall hero, short screen) => stays expanded.
          setCollapsed(!entry.isIntersecting && entry.boundingClientRect.top <= rootTop)
        },
        // root null falls back to the viewport; the app's scroll lives in the
        // region, so pass it explicitly. The top inset is the bar height.
        { root, rootMargin: `-${BAR_H}px 0px 0px 0px`, threshold: 0 },
      )
      observer.observe(sentinel)
    }
    const disarm = () => {
      observer?.disconnect()
      observer = null
      setCollapsed(false)
    }

    arm()
    const onChange = () => (desktop.matches ? disarm() : arm())
    desktop.addEventListener("change", onChange)
    return () => {
      desktop.removeEventListener("change", onChange)
      observer?.disconnect()
    }
  }, [])

  return { sentinelRef, collapsed }
}

export interface MobileCollapsingHeaderProps {
  /** Page title — a string on real pages; a <Skeleton/> in loading frames. The
   *  same node is the bar's inline (collapsed) title and the hero's big title. */
  title: React.ReactNode
  /** Tiny overline above the hero title — same rule as PageHeader: dynamic
   *  titles ("Event", "Campaign") earn it, static self-describing ones don't. */
  eyebrow?: React.ReactNode
  /** Right-side controls in the bar (mirror the desktop PageHeader actions). */
  actions?: React.ReactNode
  /** Quiet centered line under the hero title (badge · date · chips). */
  meta?: React.ReactNode
  /** Context popover (ⓘ) shown beside the hero title, like PageHeader. */
  info?: React.ReactNode
  /** Circular back link in the bar's left slot. */
  backHref?: string
  backLabel?: string
  /** A custom back affordance (history-aware button) when there's no single
   *  parent route — mirrors PageHeader.backSlot. */
  backSlot?: React.ReactNode
  /** Extra hero content rendered BELOW the title + handoff marker (e.g. the
   *  contact card's status + quick-action row). Because it sits after the
   *  sentinel, it keeps scrolling under the frosted bar once the title has handed
   *  off to the inline title — so the title swap tracks the title, not the whole
   *  hero. The component always renders `title`, so the handoff is identical. */
  heroExtra?: React.ReactNode
  className?: string
}

export function MobileCollapsingHeader({
  title,
  eyebrow,
  actions,
  meta,
  info,
  backHref,
  backLabel,
  backSlot,
  heroExtra,
  className,
}: MobileCollapsingHeaderProps) {
  const { sentinelRef, collapsed } = useCollapseOnScroll()

  const back = backSlot ? (
    backSlot
  ) : backHref ? (
    <Link
      href={backHref}
      prefetch
      aria-label={backLabel ?? "Back"}
      title={backLabel ?? "Back"}
      className="btn-icon-circle"
    >
      <ArrowLeft size={18} />
    </Link>
  ) : null

  return (
    // `contents` (the wrapper generates no box) is load-bearing: position:sticky
    // pins an element only while its PARENT is in view. A real wrapping <div> is
    // only as tall as the bar + hero, so the sticky bar would scroll away with it
    // the instant the hero cleared the top edge (the "I see the bar briefly, then
    // it scrolls away" bug). display:contents hoists the bar/hero/sentinel to be
    // direct children of [data-scroll-region], so the bar's containing block spans
    // the whole page and it stays pinned over all the content. md:hidden — the
    // whole collapsing system is phone/tablet chrome.
    <div
      data-collapsing-header
      data-collapsed={collapsed ? "true" : "false"}
      className={cn("contents md:hidden", className)}
    >
      {/* -mx-4 bleeds the frosted bar to the screen edges (the scroll region pads
          px-4); the inner grid re-applies px-4 so the controls sit on the gutter. */}
      <header className="collapse-bar -mx-4">
        <div className="collapse-bar__scrim" aria-hidden />
        <div className="collapse-bar__rule" aria-hidden />
        <div
          className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-x-[var(--space-sm)] px-4"
          style={{ minHeight: BAR_H }}
        >
          <div className="flex items-center justify-start">{back}</div>
          <p
            role="heading"
            aria-level={1}
            className="collapse-inline-title min-w-0 truncate text-center font-display text-lead font-semibold leading-none tracking-[var(--tracking-tight)] text-ink"
          >
            {title}
          </p>
          <div className="flex items-center justify-end gap-2">{actions}</div>
        </div>
      </header>

      {/* The hero scrolls away under the pinned bar. The sentinel sits right after
          the TITLE (not the whole hero), so collapse hands off as the big title
          passes under the bar — no "title gone but inline not yet" gap on tall
          heroes; meta / heroExtra below keep scrolling under the frosted bar.
          Hero is a direct child of the scroll region (contents wrapper), so its
          gutter comes from the region's px-4 — only vertical rhythm here. */}
      <div className="pt-2 pb-3">
        <div className="flex min-w-0 flex-col items-center text-center">
          {eyebrow && <span className="eyebrow leading-none">{eyebrow}</span>}
          <div className="flex min-w-0 items-center gap-2">
            <p
              aria-hidden
              className={cn(
                "min-w-0 truncate font-display text-heading font-semibold leading-[var(--leading-snug)] tracking-[var(--tracking-tight)] text-ink",
                eyebrow && "mt-1",
              )}
            >
              {title}
            </p>
            {info && <PageInfo>{info}</PageInfo>}
          </div>
        </div>

        {/* Handoff marker — directly under the title line, so the inline title
            cross-fades in exactly as the big title passes under the bar. */}
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />

        {heroExtra ? (
          <div className="mt-3">{heroExtra}</div>
        ) : meta ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {meta}
          </div>
        ) : null}
      </div>
    </div>
  )
}
