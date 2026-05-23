"use client"
import * as React from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface PageInfoProps {
  /** The text to show inside the popover. Keep it 1–3 sentences. */
  children: React.ReactNode
  /** Visible-screenreader label for the trigger. */
  label?: string
  /** Anchor side: where the popover should open relative to the trigger. */
  align?: "start" | "end"
}

/**
 * Small ⓘ button next to a page title. Tap opens a popover with context;
 * tap outside / ESC closes it. Replaces long descriptive paragraphs that
 * cluttered every page once the user knew what the page did.
 */
export function PageInfo({ children, label = "About this page", align = "start" }: PageInfoProps) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handlePointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("pointerdown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center h-7 w-7 rounded-pill text-ink-faint",
          "active:bg-white active:text-ink-muted transition-colors",
          open && "bg-white text-ink-muted",
        )}
      >
        <Info size={15} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute top-full mt-1.5 z-30 w-[min(86vw,320px)]",
            "rounded-md bg-white border border-ink-hairline shadow-[var(--shadow-md)]",
            "p-3.5 text-small text-ink-muted leading-prose",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
