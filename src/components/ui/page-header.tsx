import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageInfo } from "./page-info"

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  /** When set, renders a compact inline back affordance in the utility row. */
  backHref?: string
  backLabel?: string
  /** A custom back affordance (e.g. a history-aware button) for subviews with
   *  no single parent route. Takes the left slot in place of `backHref`. */
  backSlot?: React.ReactNode
  /** Show the back affordance only below md. For pages reached from the user
   *  menu (Settings, Audit) the desktop sidebar already provides the way out —
   *  a Back arrow next to a persistent nav reads as misplaced mobile chrome. */
  backMobileOnly?: boolean
  /** Optional context that appears in a ⓘ popover next to the title. */
  info?: React.ReactNode
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  function PageHeader(
    { className, title, eyebrow, actions, backHref, backLabel, backSlot, backMobileOnly, info, children, ...props },
    ref,
  ) {
    const hasUtilityRow = Boolean(backHref || backSlot || actions)
    // With a mobile-only back and no actions, the whole utility row is
    // mobile-only — otherwise md+ would keep an empty strip above the title.
    const utilityRowMobileOnly = Boolean(backMobileOnly && !actions)
    return (
      <header
        ref={ref}
        className={cn(
          "flex flex-col gap-[var(--space-xs)]",
          "py-[var(--space-sm)]",
          "border-b border-ink-hairline",
          className,
        )}
        {...props}
      >
        {/* Utility row: back affordance (left) + actions (right) share one row
            so the touch target does double duty instead of stacking a separate
            back band above a separate actions row. */}
        {hasUtilityRow && (
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-[var(--space-sm)] gap-y-2",
              utilityRowMobileOnly && "md:hidden",
            )}
          >
            {backSlot ? (
              backMobileOnly && actions ? (
                <span className="md:hidden">{backSlot}</span>
              ) : (
                backSlot
              )
            ) : backHref ? (
              <Link
                href={backHref}
                prefetch
                aria-label={backLabel ?? "Back"}
                className={cn(
                  "inline-flex items-center gap-1.5 shrink-0 text-small text-ink-muted hover:text-ink active:text-ink transition-colors",
                  // Mobile: a 44x44 icon-only target (matches the inbox thread-pane back)
                  // so it never crowds the action buttons on one row.
                  "justify-center h-11 w-11 -ml-2 rounded-pill hover:bg-white",
                  // Desktop: a labelled inline link, no pill.
                  "sm:h-auto sm:min-h-11 sm:w-auto sm:ml-0 sm:justify-start sm:rounded-none sm:hover:bg-transparent",
                )}
              >
                <ArrowLeft size={18} />
                {backLabel && <span className="hidden sm:inline">{backLabel}</span>}
              </Link>
            ) : (
              <span aria-hidden />
            )}
            {actions && (
              <div className="flex flex-wrap items-center justify-end gap-[var(--space-sm)]">
                {actions}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-0.5 min-w-0">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <div className="flex items-center gap-2 min-w-0">
            <h1
              className={cn(
                // Same tier as PageMasthead: console chrome sits at
                // --text-heading so detail pages and list pages agree.
                "font-display text-heading text-ink",
                "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                "font-semibold truncate",
              )}
            >
              {title}
            </h1>
            {info && <PageInfo>{info}</PageInfo>}
          </div>
        </div>
        {children}
      </header>
    )
  },
)
