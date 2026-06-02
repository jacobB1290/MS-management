"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface DropdownMenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  menuId: string
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(
  null,
)

function useDropdownMenuContext(component: string): DropdownMenuContextValue {
  const ctx = React.useContext(DropdownMenuContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <DropdownMenu>`)
  return ctx
}

export interface DropdownMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function DropdownMenu({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  React.useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (
        contentRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open, setOpen])

  const value = React.useMemo(
    () => ({ open, setOpen, triggerRef, contentRef, menuId }),
    [open, setOpen, menuId],
  )

  return (
    <DropdownMenuContext.Provider value={value}>
      <span className="relative inline-flex">{children}</span>
    </DropdownMenuContext.Provider>
  )
}

export interface DropdownMenuTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuTriggerProps
>(function DropdownMenuTrigger(
  { onClick, asChild, children, ...props },
  forwardedRef,
) {
  const { open, setOpen, triggerRef, menuId } =
    useDropdownMenuContext("DropdownMenuTrigger")

  React.useImperativeHandle(
    forwardedRef,
    () => triggerRef.current as HTMLButtonElement,
  )

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented) setOpen(!open)
  }

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
      "aria-haspopup"?: "menu"
      "aria-expanded"?: boolean
      "aria-controls"?: string
      ref?: React.Ref<HTMLButtonElement>
    }>
    return React.cloneElement(child, {
      ...props,
      ref: triggerRef,
      "aria-haspopup": "menu",
      "aria-expanded": open,
      "aria-controls": menuId,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        child.props.onClick?.(e)
        if (!e.defaultPrevented) setOpen(!open)
      },
    } as Partial<typeof child.props>)
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={menuId}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  )
})

export interface DropdownMenuContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end"
  sideOffset?: number
  /** Which way the menu opens, so the enter animation slides FROM the trigger.
   *  Default "bottom" (opens below). Pass "top" when the caller anchors the menu
   *  above its trigger (e.g. `className="bottom-full top-auto"`). */
  side?: "top" | "bottom"
}

export const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, align = "start", sideOffset = 6, side = "bottom", children, style, ...props },
  forwardedRef,
) {
  const { open, contentRef, menuId } = useDropdownMenuContext("DropdownMenuContent")

  React.useImperativeHandle(
    forwardedRef,
    () => contentRef.current as HTMLDivElement,
  )

  if (!open) return null

  return (
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      style={{ marginTop: sideOffset, ...style }}
      className={cn(
        "absolute z-40 top-full",
        align === "end" ? "right-0" : "left-0",
        "min-w-[180px]",
        "bg-white border border-ink-hairline rounded-md",
        "shadow-[var(--shadow-md)]",
        "p-1.5 flex flex-col",
        side === "top"
          ? "animate-[menu-in-up_var(--motion-fast)_var(--ease-out-soft)_backwards]"
          : "animate-[menu-in_var(--motion-fast)_var(--ease-out-soft)_backwards]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})

export interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean
  closeOnSelect?: boolean
}

export const DropdownMenuItem = React.forwardRef<
  HTMLButtonElement,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  { className, destructive, closeOnSelect = true, onClick, children, ...props },
  ref,
) {
  const { setOpen } = useDropdownMenuContext("DropdownMenuItem")
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented && closeOnSelect) setOpen(false)
      }}
      className={cn(
        "flex items-center gap-2 w-full text-left",
        "px-3 py-2 rounded-sm",
        "text-small",
        destructive ? "text-danger" : "text-ink",
        "hover:bg-surface focus-visible:bg-surface",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

export const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "px-3 pt-2 pb-1",
        "text-eyebrow font-semibold uppercase",
        "tracking-[var(--tracking-wide)] text-ink-faint",
        className,
      )}
      {...props}
    />
  )
})

export const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      role="separator"
      className={cn("my-1 h-px bg-ink-hairline", className)}
      {...props}
    />
  )
})
