import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn, initials } from "@/lib/utils"

const avatarVariants = cva(
  "inline-flex items-center justify-center rounded-pill bg-gold text-white font-semibold uppercase select-none shrink-0",
  {
    variants: {
      size: {
        sm: "h-8 w-8 text-label",
        md: "h-10 w-10 text-small",
        lg: "h-14 w-14 text-lead",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
)

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  name?: string | null
}

export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  function Avatar({ className, size, name, children, ...props }, ref) {
    const content = children ?? initials(name)
    return (
      <span
        ref={ref}
        aria-label={name ?? undefined}
        className={cn(avatarVariants({ size }), className)}
        {...props}
      >
        {content}
      </span>
    )
  },
)
