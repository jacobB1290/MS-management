import * as React from "react"
import { cn } from "@/lib/utils"

export type CardProps = React.HTMLAttributes<HTMLDivElement>

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "bg-white border border-ink-hairline rounded-lg",
          "shadow-[var(--shadow-sm)]",
          "p-[var(--space-md)] sm:p-[var(--space-lg)]",
          className,
        )}
        {...props}
      />
    )
  },
)

export const CardHeader = React.forwardRef<HTMLDivElement, CardProps>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-[var(--space-xs)] mb-[var(--space-md)]",
          className,
        )}
        {...props}
      />
    )
  },
)

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn(
        "font-display text-[var(--text-heading)] text-ink",
        "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
        "font-semibold",
        className,
      )}
      {...props}
    />
  )
})

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn(
        "text-[var(--text-small)] text-ink-muted leading-[var(--leading-prose)]",
        className,
      )}
      {...props}
    />
  )
})

export const CardContent = React.forwardRef<HTMLDivElement, CardProps>(
  function CardContent({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-[var(--space-sm)]", className)}
        {...props}
      />
    )
  },
)

export const CardFooter = React.forwardRef<HTMLDivElement, CardProps>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-[var(--space-sm)] mt-[var(--space-md)] pt-[var(--space-md)]",
          "border-t border-ink-hairline",
          className,
        )}
        {...props}
      />
    )
  },
)
