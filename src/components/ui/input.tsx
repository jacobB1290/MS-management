import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** "box" is the standard white field; "quiet" is the editorial underline
   *  field used on composition surfaces (event editor, campaign composer). */
  variant?: "box" | "quiet"
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type = "text", variant = "box", ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          // min-w-0 lets the field shrink to its container instead of forcing
          // overflow — notably iOS's native date/time controls, which carry a
          // chunky intrinsic min-width and otherwise push the page sideways.
          "block w-full min-w-0 h-11 text-body text-ink",
          "placeholder:text-ink-faint",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          variant === "quiet"
            ? "field-quiet"
            : cn(
                "bg-white border border-ink-hairline rounded-md px-3",
                "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                "focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2",
                "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
              ),
          className,
        )}
        {...props}
      />
    )
  },
)
