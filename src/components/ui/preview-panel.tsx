import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The xl+ preview side panel for the composition surfaces: a vertical
 * hairline and a faintly tinted plane that runs from the header hairline to
 * the editor bar and bleeds to the right screen edge — the preview lives in
 * its own pane, segmented from the configurator, not floating in its corner.
 * Hidden below xl, where previews fold into the flow on their PreviewStage
 * well. One component for every editor; don't fork the treatment.
 *
 * Geometry contract: the page body wrapper gives the editor grid `pt-6`, and
 * the EditorBar follows the grid at `mt-[var(--space-2xl)]` — the plane's
 * negative top/bottom extents bridge exactly those two gaps, and its negative
 * right margins mirror PAGE_GUTTER's xl paddings.
 */
export function PreviewPanel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <aside className={cn("relative hidden xl:block xl:pl-[var(--space-xl)]", className)}>
      <div
        aria-hidden
        className={cn(
          "absolute left-0 -top-6 -bottom-[var(--space-2xl)]",
          "-right-12 2xl:-right-16",
          "border-l border-ink-hairline bg-ink/[0.02]",
        )}
      />
      <div className="sticky top-6 pb-[var(--space-lg)]">{children}</div>
    </aside>
  )
}
