import * as React from "react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  body?: React.ReactNode
  action?: React.ReactNode
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    { className, icon, title, body, action, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center text-center",
          "py-[var(--space-2xl)] px-[var(--space-md)]",
          "gap-[var(--space-sm)]",
          className,
        )}
        {...props}
      >
        {icon && (
          <div
            aria-hidden="true"
            className={cn(
              "inline-flex items-center justify-center",
              "h-14 w-14 rounded-pill bg-surface text-ink-faint",
              "mb-[var(--space-xs)]",
            )}
          >
            {icon}
          </div>
        )}
        <h3
          className={cn(
            // One tier below the page title (--text-heading) so an empty list
            // never out-shouts the page's own header.
            "font-display text-lead font-semibold",
            "text-ink leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
          )}
        >
          {title}
        </h3>
        {body && (
          <p
            className={cn(
              "text-body text-ink-muted",
              "leading-[var(--leading-prose)] max-w-prose",
            )}
          >
            {body}
          </p>
        )}
        {action && <div className="mt-[var(--space-sm)]">{action}</div>}
      </div>
    )
  },
)
