import { cn } from "@/lib/utils"

/**
 * Desktop masthead for top-level console pages: eyebrow + display title +
 * optional one-line description. Hidden below md — the mobile topbar already
 * titles the page, so an in-page masthead would just duplicate it and add
 * height. This is the pattern Events established; one component so Contacts /
 * Campaigns / Events can never drift apart again.
 */
export function PageMasthead({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn("hidden min-w-0 md:block", className)}>
      <p className="eyebrow">Console</p>
      <h1 className="font-display text-title font-semibold leading-[var(--leading-snug)] tracking-[var(--tracking-tight)] text-ink">
        {title}
      </h1>
      {description && <p className="mt-1 text-body text-ink-muted">{description}</p>}
    </div>
  )
}
