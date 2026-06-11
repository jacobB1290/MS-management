import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageInfo } from "./page-info"

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  /** Tiny centered overline above the title. Only for dynamic titles ("Event",
   *  "Campaign" over user-entered text) — a static self-describing title
   *  ("Settings", "New campaign") doesn't earn the row. */
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  /** When set, renders the circular back button in the left slot. */
  backHref?: string
  backLabel?: string
  /** A custom back affordance (e.g. a history-aware button) for subviews with
   *  no single parent route. Takes the left slot in place of `backHref`. */
  backSlot?: React.ReactNode
  /** Show the back affordance only below md. For pages reached from the user
   *  menu (Settings, Audit) the desktop sidebar already provides the way out —
   *  a back button next to a persistent nav reads as misplaced mobile chrome. */
  backMobileOnly?: boolean
  /** Optional context that appears in a ⓘ popover next to the title. */
  info?: React.ReactNode
  /** One quiet centered line under the title (status badge · date · links).
   *  Keep it to a single line of small inline pieces. */
  meta?: React.ReactNode
}

/**
 * Subpage chrome: one compact centered band at the top edge.
 *
 * md+ is a single balanced `1fr auto 1fr` row — circular back button in the
 * left corner, title (with its optional eyebrow tucked tight above) at a true
 * center, actions in the right corner. Below md the title earns the full
 * width instead of being squeezed between the corners: back + actions share
 * a utility row and the centered title block sits on its own line beneath.
 * The optional `meta` line (status badge · date · chips) settles centered
 * under the title at every size. The header owns its hairline + padding;
 * never wrap it in another bordered div.
 */
export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  function PageHeader(
    { className, title, eyebrow, actions, backHref, backLabel, backSlot, backMobileOnly, info, meta, children, ...props },
    ref,
  ) {
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

    // With nothing in either corner the mobile utility row would render as a
    // blank band — collapse to the title alone (md+ grid handles it anyway).
    const hasCorners = Boolean(back || actions)

    return (
      <header
        ref={ref}
        className={cn("border-b border-ink-hairline pb-3", className)}
        {...props}
      >
        <div
          className={cn(
            "grid items-center gap-x-[var(--space-sm)]",
            hasCorners
              ? cn(
                  // Mobile: corners on the first row, title full-width below.
                  "grid-cols-[1fr_1fr] [grid-template-areas:'back_actions'_'title_title'] gap-y-1.5",
                  // md+: one balanced row, title at a true center.
                  "md:min-h-11 md:grid-cols-[1fr_auto_1fr] md:[grid-template-areas:'back_title_actions'] md:gap-y-0",
                )
              : "min-h-11 grid-cols-[minmax(0,1fr)] [grid-template-areas:'title']",
          )}
        >
          {hasCorners && (
            <div className="flex items-center justify-start [grid-area:back]">
              {back && (
                <span className={cn(backMobileOnly && "md:hidden")}>{back}</span>
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col items-center text-center [grid-area:title]">
            {eyebrow && <span className="eyebrow leading-none">{eyebrow}</span>}
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className={cn(
                  // Console chrome tier — same as PageMasthead, so list pages
                  // and detail pages agree.
                  "font-display text-heading text-ink",
                  "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                  "font-semibold truncate",
                  eyebrow && "mt-0.5",
                )}
              >
                {title}
              </h1>
              {info && <PageInfo>{info}</PageInfo>}
            </div>
          </div>
          {hasCorners && (
            <div className="flex items-center justify-end gap-2 [grid-area:actions]">
              {actions}
            </div>
          )}
        </div>
        {meta && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {meta}
          </div>
        )}
        {children}
      </header>
    )
  },
)
