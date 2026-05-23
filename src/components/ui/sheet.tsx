"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type SheetSide = "bottom" | "right" | "left" | "top"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  side: SheetSide
  titleId: string
  descriptionId: string
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheetContext(component: string): SheetContextValue {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Sheet>`)
  return ctx
}

export interface SheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  side?: SheetSide
  children: React.ReactNode
}

export function Sheet({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  side = "bottom",
  children,
}: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const titleId = React.useId()
  const descriptionId = React.useId()

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const value = React.useMemo(
    () => ({ open, setOpen, side, titleId, descriptionId }),
    [open, setOpen, side, titleId, descriptionId],
  )

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>
}

export interface SheetTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const SheetTrigger = React.forwardRef<
  HTMLButtonElement,
  SheetTriggerProps
>(function SheetTrigger({ onClick, asChild, children, ...props }, ref) {
  const { setOpen } = useSheetContext("SheetTrigger")

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
    }>
    return React.cloneElement(child, {
      ...props,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        child.props.onClick?.(e)
        if (!e.defaultPrevented) setOpen(true)
      },
    } as Partial<typeof child.props>)
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(true)
      }}
      {...props}
    >
      {children}
    </button>
  )
})

const sideClasses: Record<SheetSide, string> = {
  bottom:
    "inset-x-0 bottom-0 max-h-[92vh] rounded-t-xl border-t data-[state=closed]:translate-y-full",
  top: "inset-x-0 top-0 max-h-[92vh] rounded-b-xl border-b data-[state=closed]:-translate-y-full",
  right:
    "right-0 top-0 h-full w-[min(92vw,440px)] border-l data-[state=closed]:translate-x-full",
  left: "left-0 top-0 h-full w-[min(92vw,440px)] border-r data-[state=closed]:-translate-x-full",
}

export interface SheetContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  showCloseButton?: boolean
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  function SheetContent(
    { className, children, showCloseButton = true, ...props },
    ref,
  ) {
    const { open, setOpen, side, titleId, descriptionId } =
      useSheetContext("SheetContent")
    const [mounted, setMounted] = React.useState(open)

    // Sync mount visibility with open prop; setState on open transition is
    // intentional (it's the controlled-exit-animation pattern).
    if (open && !mounted) {
      setMounted(true)
    }
    React.useEffect(() => {
      if (open) return
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }, [open])

    React.useEffect(() => {
      if (!open) return
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false)
      }
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }, [open, setOpen])

    React.useEffect(() => {
      if (!mounted) return
      const previous = document.body.style.overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = previous
      }
    }, [mounted])

    if (!mounted) return null

    return (
      <div className="fixed inset-0 z-50" role="presentation">
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          data-state={open ? "open" : "closed"}
          className={cn(
            "absolute inset-0 bg-ink/40 backdrop-blur-sm",
            "transition-opacity duration-[var(--motion-medium)] ease-[var(--ease-standard)]",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-state={open ? "open" : "closed"}
          className={cn(
            "absolute bg-surface text-ink border-ink-hairline shadow-[var(--shadow-xl)]",
            "p-[var(--space-lg)] flex flex-col gap-[var(--space-md)]",
            "transition-transform duration-[var(--motion-medium)] ease-[var(--ease-out-soft)]",
            "will-change-transform",
            sideClasses[side],
            !open && "pointer-events-none",
            className,
          )}
          {...props}
        >
          {showCloseButton && (
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className={cn(
                "absolute top-3 right-3",
                "inline-flex items-center justify-center",
                "h-8 w-8 rounded-pill",
                "text-ink-muted hover:text-ink hover:bg-bg",
                "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
              )}
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {children}
        </div>
      </div>
    )
  },
)

export const SheetHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function SheetHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-[var(--space-xs)]", className)}
      {...props}
    />
  )
})

export const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function SheetTitle({ className, ...props }, ref) {
  const { titleId } = useSheetContext("SheetTitle")
  return (
    <h2
      ref={ref}
      id={titleId}
      className={cn(
        "font-display text-heading text-ink",
        "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
        "font-semibold",
        className,
      )}
      {...props}
    />
  )
})

export const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function SheetDescription({ className, ...props }, ref) {
  const { descriptionId } = useSheetContext("SheetDescription")
  return (
    <p
      ref={ref}
      id={descriptionId}
      className={cn(
        "text-small text-ink-muted leading-[var(--leading-prose)]",
        className,
      )}
      {...props}
    />
  )
})

export const SheetFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function SheetFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "mt-auto flex flex-col-reverse sm:flex-row sm:justify-end",
        "gap-[var(--space-sm)] pt-[var(--space-sm)]",
        className,
      )}
      {...props}
    />
  )
})
