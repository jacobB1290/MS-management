import * as React from "react"
import { cn } from "@/lib/utils"

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
}

export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  function PageHeader(
    { className, title, eyebrow, actions, children, ...props },
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
            <h1
              className={cn(
                "font-display text-[var(--text-title)] text-ink",
                "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                "font-semibold",
              )}
            >
              {title}
            </h1>
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
