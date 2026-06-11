"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * The canonical toggle: a 44px-tall hit area around a compact gold track, with
 * the thumb gliding (never snapping) between states. Extracted from the event
 * editor's all-day control so every editor shares one switch.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch({ checked, onCheckedChange, className, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        // The visual track is 24px; the button pads it out to a 44px-tall
        // touch target without inflating the layout row.
        className={cn(
          "inline-flex h-11 shrink-0 items-center justify-center px-1 -mx-1",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "relative block h-6 w-11 rounded-pill",
            "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
            checked ? "bg-gold" : "bg-ink-fade",
          )}
        >
          {/* Anchored hard to the track's left edge — an absolutely positioned
              element with no `left` keeps its static (text-flow) position, so
              an inherited text-align could float the thumb out of the pill. */}
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-5 w-5 rounded-pill bg-white shadow-sm",
              "transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              checked ? "translate-x-5" : "translate-x-0",
            )}
          />
        </span>
      </button>
    )
  },
)
