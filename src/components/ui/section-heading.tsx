import { cn } from "@/lib/utils"

/**
 * In-page section heading: a display-face label with a hairline rule running
 * to the edge — the pattern Events established ("Upcoming", "Past"), promoted
 * here so every page separates its sections the same way. Sits one type tier
 * below the page title.
 */
export function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-4 flex items-center gap-3", className)}>
      <h2 className="font-display text-lead font-medium text-ink">{children}</h2>
      <span className="h-px flex-1 bg-ink-hairline" aria-hidden />
    </div>
  )
}
