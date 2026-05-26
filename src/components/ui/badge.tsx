import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 font-semibold uppercase whitespace-nowrap text-eyebrow tracking-[var(--tracking-wide)] leading-none",
  {
    variants: {
      variant: {
        default: "bg-surface text-ink-muted",
        success: "bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] text-success",
        warning: "bg-[color-mix(in_oklab,var(--color-warning)_18%,transparent)] text-warning",
        danger: "bg-[color-mix(in_oklab,var(--color-danger)_14%,transparent)] text-danger",
        gold: "bg-[color-mix(in_oklab,var(--gold)_16%,transparent)] text-gold-dark",
        muted: "bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] text-ink-muted",
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
