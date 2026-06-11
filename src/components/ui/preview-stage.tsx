import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The display case for live previews (the recipient's phone, the ms.church
 * site card): a softly recessed well, one step darker than the canvas, with
 * the eyebrow label inside. The recess is the signal — fields are filled
 * wells you type into, the stage is a backdrop things sit ON — so the
 * preview reads as an exhibit, not stray interactive chrome floating in the
 * corner. Shared by every composition surface; don't fork the treatment.
 */
export function PreviewStage({
  label,
  caption,
  className,
  variant = "well",
  children,
}: {
  label: React.ReactNode
  /** Quiet fine print under the exhibit (sizes, latency, formats). */
  caption?: React.ReactNode
  className?: string
  /** "well" is the recessed stage for previews inline in the editor flow;
   *  "bare" drops the recess for use inside the xl preview side panel, which
   *  already provides the separation. */
  variant?: "well" | "bare"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        variant === "well" &&
          "rounded-xl bg-ink/[0.03] px-[var(--space-md)] py-[var(--space-md)]",
        className,
      )}
    >
      <p className="eyebrow mb-3.5">{label}</p>
      {children}
      {caption && (
        <p className="mt-3.5 text-micro leading-[var(--leading-prose)] text-ink-faint">
          {caption}
        </p>
      )}
    </div>
  )
}
