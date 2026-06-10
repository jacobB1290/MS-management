"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean
  /** "box" is the standard white field; "quiet" is the editorial underline
   *  field used on composition surfaces (event editor, campaign composer). */
  variant?: "box" | "quiet"
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, autoGrow = false, variant = "box", onChange, rows = 3, ...props },
    ref,
  ) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    React.useImperativeHandle(
      ref,
      () => innerRef.current as HTMLTextAreaElement,
    )

    // Safari 26.2+ / Chromium grow the field natively via `field-sizing:
    // content` (applied in CSS). When that's available we skip the JS height
    // measurement entirely — no per-keystroke reflow. Older WebKit keeps the
    // measure-and-set fallback. Evaluated once on the client; SSR-safe.
    const nativeFieldSizing = React.useMemo(
      () =>
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("field-sizing: content"),
      [],
    )
    const jsAutoGrow = autoGrow && !nativeFieldSizing

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }, [])

    React.useEffect(() => {
      if (jsAutoGrow) resize()
    }, [jsAutoGrow, resize, props.value, props.defaultValue])

    return (
      <textarea
        ref={innerRef}
        rows={rows}
        onChange={(event) => {
          if (jsAutoGrow) resize()
          onChange?.(event)
        }}
        className={cn(
          "block w-full py-2.5 text-body text-ink",
          "min-h-[88px] resize-y",
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
          // `field-sizing-content` lets WebKit/Chromium grow the box; the JS
          // fallback uses overflow-hidden + measured height instead.
          autoGrow && "resize-none overflow-hidden field-sizing-content",
          className,
        )}
        {...props}
      />
    )
  },
)
