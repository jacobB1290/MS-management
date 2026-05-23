import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-semibold uppercase whitespace-nowrap text-[var(--text-eyebrow)] tracking-[var(--tracking-wide)] leading-none",
  {
    variants: {
      variant: {
        default: "bg-surface text-ink-muted",
        // Colored variants are SOLID fills with white text — consistent
        // contrast against any backdrop and matches the canonical gold
        // CTA pill's white-on-color treatment.
        success: "bg-success text-white",
        warning: "bg-warning text-white",
        danger: "bg-danger text-white",
        gold: "bg-gold text-white",
        muted: "bg-transparent text-ink-faint",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge({ className, variant, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    )
  },
)

export { badgeVariants }
