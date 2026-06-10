import { cn } from "@/lib/utils"

/**
 * THE header for top-level console pages (Inbox excepted — its rail owns its
 * own chrome). One component, one rhythm, so Contacts / Events / Campaigns can
 * never drift apart again:
 *
 *   ┌ title (display face, --text-heading) ········· actions (right) ┐
 *   │ description (one quiet line under the title)                   │
 *   │ toolbar (optional full-width row: search, filters)             │
 *   └────────────────────────── hairline ────────────────────────────┘
 *
 * Sizing intent: this is product chrome, not the marketing site — the title
 * sits one tier below the editorial --text-title so the header stays compact
 * and the content owns the screen. Identity still reads Playfair.
 *
 * Below md the title block hides (the mobile topbar already names the page) and
 * the header collapses to just its working parts: actions and/or toolbar on a
 * single tight row. The hairline + padding live HERE — pages must not wrap this
 * in their own bordered divs.
 */
export function PageMasthead({
  title,
  description,
  actions,
  toolbar,
  className,
}: {
  title: string
  description?: string
  /** Right-aligned controls. Order: secondary actions first, the primary
   *  `.btn-icon-action` circle last (outermost corner, same spot on every page). */
  actions?: React.ReactNode
  /** Optional full-width row under the title (search, filters). On mobile this
   *  row IS the header, sharing the line with `actions`. */
  toolbar?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn("border-b border-ink-hairline pb-3 md:pb-4", className)}
    >
      <div className="flex items-center justify-between gap-[var(--space-sm)]">
        <div className="hidden min-w-0 md:block">
          <h1 className="font-display text-heading font-semibold leading-[var(--leading-snug)] tracking-[var(--tracking-tight)] text-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 truncate text-compact text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {/* On mobile the toolbar shares the header row with the actions so the
            chrome is one 44px band, not a stack of part-empty rows. */}
        {toolbar && <div className="min-w-0 flex-1 md:hidden">{toolbar}</div>}
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {toolbar && <div className="mt-3 hidden md:block">{toolbar}</div>}
    </header>
  )
}
