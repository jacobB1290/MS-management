"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { MOTION_FAST_MS, exitDurationMs } from "@/lib/motion"

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  dialogRef: React.RefObject<HTMLDialogElement | null>
  titleId: string
  descriptionId: string
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext(component: string): DialogContextValue {
  const ctx = React.useContext(DialogContext)
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <Dialog>`)
  }
  return ctx
}

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()
  const descriptionId = React.useId()

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  // Animated lifecycle. showModal()/close() are hard cuts by nature, so the
  // close is two-phase: mark the dialog data-closing (globals.css plays the
  // panel + backdrop exit animation), then actually close once it has run.
  // Reopening mid-exit cancels the pending close. Under reduced motion the
  // hold collapses to 0 alongside the CSS.
  React.useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      dialog.removeAttribute("data-closing")
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.setAttribute("data-closing", "")
      closeTimer = setTimeout(() => {
        dialog.removeAttribute("data-closing")
        if (dialog.open) dialog.close()
      }, exitDurationMs(MOTION_FAST_MS))
    }
    return () => {
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [open])

  const value = React.useMemo(
    () => ({ open, setOpen, dialogRef, titleId, descriptionId }),
    [open, setOpen, titleId, descriptionId],
  )

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
}

export interface DialogTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DialogTrigger = React.forwardRef<
  HTMLButtonElement,
  DialogTriggerProps
>(function DialogTrigger({ onClick, asChild, children, ...props }, ref) {
  const { setOpen } = useDialogContext("DialogTrigger")
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented) setOpen(true)
  }

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
    <button ref={ref} type="button" onClick={handleClick} {...props}>
      {children}
    </button>
  )
})

export interface DialogContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  showCloseButton?: boolean
}

export const DialogContent = React.forwardRef<
  HTMLDialogElement,
  DialogContentProps
>(function DialogContent(
  { className, children, showCloseButton = true, ...props },
  forwardedRef,
) {
  const { dialogRef, setOpen, titleId, descriptionId } =
    useDialogContext("DialogContent")

  React.useImperativeHandle(
    forwardedRef,
    () => dialogRef.current as HTMLDialogElement,
  )

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={() => setOpen(false)}
      onCancel={(event) => {
        event.preventDefault()
        setOpen(false)
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
      className={cn(
        "p-0 m-auto bg-transparent text-ink",
        "max-w-[min(92vw,520px)] w-full",
        "backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          // .dialog-panel hooks the enter/exit animations in globals.css.
          "dialog-panel",
          "bg-surface rounded-lg shadow-[var(--shadow-xl)]",
          "border border-ink-hairline",
          "p-[var(--space-lg)]",
          "flex flex-col gap-[var(--space-md)]",
          "relative",
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
    </dialog>
  )
})

export const DialogHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-[var(--space-xs)]", className)}
      {...props}
    />
  )
})

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function DialogTitle({ className, ...props }, ref) {
  const { titleId } = useDialogContext("DialogTitle")
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

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function DialogDescription({ className, ...props }, ref) {
  const { descriptionId } = useDialogContext("DialogDescription")
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

export const DialogFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DialogFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end",
        "gap-[var(--space-sm)] mt-[var(--space-sm)]",
        className,
      )}
      {...props}
    />
  )
})
