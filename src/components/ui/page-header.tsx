import * as React from "react"
import { cn } from "@/lib/utils"
import { PageInfo } from "./page-info"

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  /** Optional context that appears in a ⓘ popover next to the title. */
  info?: React.ReactNode
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  function PageHeader(
    { className, title, eyebrow, actions, info, children, ...props },
    ref,
  ) {
    return (
      <header
        ref={ref}
        className={cn(
          "flex flex-col gap-[var(--space-md)]",
          "py-[var(--space-lg)]",
          "border-b border-ink-hairline",
          className,
        )}
        {...props}
      >
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-[var(--space-sm)]">
          <div className="flex flex-col gap-[var(--space-xs)] min-w-0">
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className={cn(
                  "font-display text-title text-ink",
                  "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                  "font-semibold truncate",
                )}
              >
                {title}
              </h1>
              {info && <PageInfo>{info}</PageInfo>}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-[var(--space-sm)] shrink-0">
              {actions}
            </div>
          )}
        </div>
        {children}
      </header>
    )
  },
)
