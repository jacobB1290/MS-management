import * as React from "react"
import { cn } from "@/lib/utils"

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn(
          "inline-block text-small font-medium text-ink-muted",
          "leading-[var(--leading-snug)]",
          className,
        )}
        {...props}
      />
    )
  },
)
