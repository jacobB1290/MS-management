import * as React from "react"
import { cn } from "@/lib/utils"

export interface EditorSectionProps {
  title: string
  /** Optional editorial step numeral ("01", "02"…) for sequential composers. */
  step?: string
  /** Small note that sits at the right end of the rule (e.g. a compact control
   *  or an "optional" whisper). */
  aside?: React.ReactNode
  /** One quiet sentence of context under the heading, instead of scattering
   *  per-field hint crumbs. */
  note?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * The editorial section device shared by the composition surfaces: a Playfair
 * heading (optionally numbered in italic gold) on a gold rule that dissolves
 * to the right. Sections breathe; fields inside sit flush on the cream canvas.
 */
export function EditorSection({
  title,
  step,
  aside,
  note,
  className,
  children,
}: EditorSectionProps) {
  return (
    <section className={cn("min-w-0", className)}>
      <header className="flex items-baseline gap-[var(--space-sm)]">
        {step && (
          <span
            aria-hidden
            className="font-display text-heading italic leading-none text-gold/60"
          >
            {step}
          </span>
        )}
        <h2 className="shrink-0 font-display text-heading font-medium leading-none text-ink">
          {title}
        </h2>
        <span
          aria-hidden
          className="h-px min-w-[var(--space-md)] flex-1 self-center bg-gradient-to-r from-gold/40 to-transparent"
        />
        {aside && <span className="shrink-0 self-center">{aside}</span>}
      </header>
      {note && (
        <p className="mt-[var(--space-xs)] max-w-prose text-small text-ink-muted leading-[var(--leading-prose)]">
          {note}
        </p>
      )}
      <div className="mt-[var(--space-md)] space-y-[var(--space-lg)]">{children}</div>
    </section>
  )
}
