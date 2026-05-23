import * as React from "react"
import { cn } from "@/lib/utils"

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          "block rounded-md",
          "bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]",
          "animate-pulse",
          className,
        )}
        {...props}
      />
    )
  },
)
