import * as React from "react"
import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type = "text", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "block w-full bg-white border border-ink-hairline rounded-md",
          "h-11 px-3 text-body text-ink",
          "placeholder:text-ink-faint",
          "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
          "focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
          className,
        )}
        {...props}
      />
    )
  },
)
