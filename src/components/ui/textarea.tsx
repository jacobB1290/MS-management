"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, autoGrow = false, onChange, rows = 3, ...props },
    ref,
  ) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    React.useImperativeHandle(
      ref,
      () => innerRef.current as HTMLTextAreaElement,
    )

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }, [])

    React.useEffect(() => {
      if (autoGrow) resize()
    }, [autoGrow, resize, props.value, props.defaultValue])

    return (
      <textarea
        ref={innerRef}
        rows={rows}
        onChange={(event) => {
          if (autoGrow) resize()
          onChange?.(event)
        }}
        className={cn(
          "block w-full bg-white border border-ink-hairline rounded-md",
          "px-3 py-2.5 text-body text-ink",
          "min-h-[88px] resize-y",
          "placeholder:text-ink-faint",
          "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
          "focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
          autoGrow && "resize-none overflow-hidden",
          className,
        )}
        {...props}
      />
    )
  },
)
