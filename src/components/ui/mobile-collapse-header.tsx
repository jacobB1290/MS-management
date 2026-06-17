"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { PAGE_GUTTER, PAGE_GUTTER_BLEED } from "./page-scaffold"

export interface MobileCollapseHeaderProps {
  /** Big centered title at rest; the same text shrinks into the pinned bar on
   *  scroll. A node is allowed (e.g. a loading skeleton) — pass `titleText` for
   *  the compact bar + aria when `title` isn't a plain string. */
  title: React.ReactNode
  titleText?: string
  /** Tiny centered overline above the large title (dynamic titles only). */
  eyebrow?: React.ReactNode
  /** One quiet centered line under the large title (badge · date · chips). */
  meta?: React.ReactNode
  /** Left slot in the pinned bar — the circular back affordance. */
  back?: React.ReactNode
  /** Right slot in the pinned bar (stays reachable while the page scrolls). */
  actions?: React.ReactNode
  /** Extra hero content under the meta (e.g. contact quick-actions) that scrolls
   *  away with the large title. */
  children?: React.ReactNode
  className?: string
}

/**
 * The mobile-only iOS large-title chrome for subview/detail pages. At rest the
 * page shows a big centered title (the same --text-heading tier as the desktop
 * PageHeader); as the page scrolls, the large title slides up under a pinned bar
 * that fades from transparent to a blurred cream band, and a compact copy of the
 * title cross-fades into the bar. Content passing under the bar is softened by
 * the backdrop blur instead of hard-clipping at a hairline.
 *
 * Mechanism: two IntersectionObservers against the scaffold's single scroll
 * region (`[data-scroll-region]`) — one sentinel at the very top flips the bar
 * to its solid state the instant the page leaves rest; the large <h1> itself
 * drives the compact-title cross-fade once it has slid under the bar. No scroll
 * handler runs per frame, so the motion stays cheap and smooth. Reduced motion
 * keeps the end states and drops the transitions.
 *
 * This is `md:hidden` chrome: desktop keeps the pinned, centered PageHeader.
 */
export function MobileCollapseHeader({
  title,
  titleText,
  eyebrow,
  meta,
  back,
  actions,
  children,
  className,
}: MobileCollapseHeaderProps) {
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const topRef = React.useRef<HTMLDivElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)
  // `scrolled` solidifies the bar; `collapsed` cross-fades in the compact title.
  const [scrolled, setScrolled] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    const titleEl = titleRef.current
    const topEl = topRef.current
    if (!titleEl || !topEl) return
    const root = titleEl.closest<HTMLElement>("[data-scroll-region]") ?? null
    const barH = barRef.current?.offsetHeight ?? 44

    // The very top of the content leaving the viewport means we're off rest —
    // solidify the bar (cream + blur + hairline) immediately.
    const topObs = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), {
      root,
      threshold: 0,
    })
    topObs.observe(topEl)

    // The large title sliding fully under the bar is the cue to reveal the
    // compact title — the bar height is the boundary.
    const titleObs = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), {
      root,
      rootMargin: `-${barH}px 0px 0px 0px`,
      threshold: 0,
    })
    titleObs.observe(titleEl)

    return () => {
      topObs.disconnect()
      titleObs.disconnect()
    }
  }, [])

  const label = titleText ?? (typeof title === "string" ? title : undefined)

  return (
    <header className={cn("relative", className)}>
      {/* Rest sentinel: its exit flips the bar to its solid state. */}
      <div ref={topRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" />

      {/* Pinned bar — full-bleed so the blur reaches the screen edges, then
          re-padded to the page gutter for its contents. */}
      <div className={cn("sticky top-0 z-30", PAGE_GUTTER_BLEED)}>
        <div
          ref={barRef}
          data-collapse-bar
          data-scrolled={scrolled ? "true" : "false"}
          className={cn(
            "backdrop-blur-md transition-colors duration-[var(--motion-medium)] ease-[var(--ease-standard)] motion-reduce:transition-none",
            PAGE_GUTTER,
            scrolled
              ? "border-b border-ink-hairline bg-bg/80"
              : "border-b border-transparent bg-transparent",
          )}
        >
          <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-x-[var(--space-sm)]">
            <div className="flex items-center justify-start">{back}</div>
            <span
              aria-hidden={!collapsed}
              data-collapse-title
              data-collapsed={collapsed ? "true" : "false"}
              className={cn(
                "min-w-0 truncate text-center font-display text-body font-semibold text-ink",
                "transition-opacity duration-[var(--motion-medium)] ease-[var(--ease-standard)] motion-reduce:transition-none",
                collapsed ? "opacity-100" : "opacity-0",
              )}
            >
              {label}
            </span>
            <div className="flex items-center justify-end gap-2">{actions}</div>
          </div>
        </div>
      </div>

      {/* Large hero — scrolls away under the bar. */}
      <div className="flex flex-col items-center pb-1 text-center">
        {eyebrow && <span className="eyebrow leading-none">{eyebrow}</span>}
        <h1
          ref={titleRef}
          className={cn(
            "max-w-full truncate font-display text-heading font-semibold text-ink",
            "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
            eyebrow && "mt-0.5",
          )}
        >
          {title}
        </h1>
        {meta && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">{meta}</div>
        )}
        {children}
      </div>
    </header>
  )
}
