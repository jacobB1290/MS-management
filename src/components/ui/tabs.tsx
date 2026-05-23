"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsContextValue {
  value: string
  setValue: (value: string) => void
  baseId: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error(`<${component}> must be used inside <Tabs>`)
  return ctx
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    className,
    value: controlledValue,
    defaultValue = "",
    onValueChange,
    children,
    ...props
  },
  ref,
) {
  const [uncontrolledValue, setUncontrolledValue] =
    React.useState(defaultValue)
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : uncontrolledValue
  const baseId = React.useId()

  const setValue = React.useCallback(
    (next: string) => {
      if (!isControlled) setUncontrolledValue(next)
      onValueChange?.(next)
    },
    [isControlled, onValueChange],
  )

  const contextValue = React.useMemo(
    () => ({ value, setValue, baseId }),
    [value, setValue, baseId],
  )

  return (
    <TabsContext.Provider value={contextValue}>
      <div
        ref={ref}
        className={cn("flex flex-col gap-[var(--space-md)]", className)}
        {...props}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
})

export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function TabsList({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        "flex items-center gap-[var(--space-md)]",
        "border-b border-ink-hairline",
        className,
      )}
      {...props}
    />
  )
})

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  function TabsTrigger({ className, value, onClick, children, ...props }, ref) {
    const ctx = useTabsContext("TabsTrigger")
    const selected = ctx.value === value

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={selected}
        aria-controls={`${ctx.baseId}-panel-${value}`}
        id={`${ctx.baseId}-trigger-${value}`}
        tabIndex={selected ? 0 : -1}
        data-state={selected ? "active" : "inactive"}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) ctx.setValue(value)
        }}
        className={cn(
          "relative inline-flex items-center gap-2 py-3 px-1",
          "text-small font-medium tracking-[var(--tracking-wide)]",
          "uppercase",
          "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
          "after:content-[''] after:absolute after:left-0 after:right-0 after:-bottom-px",
          "after:h-[2px] after:bg-gold after:scale-x-0 after:origin-left",
          "after:transition-transform after:duration-[var(--motion-medium)] after:ease-[var(--ease-out-soft)]",
          selected
            ? "text-ink after:scale-x-100"
            : "text-ink-faint hover:text-ink-muted",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  forceMount?: boolean
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  function TabsContent(
    { className, value, forceMount, children, ...props },
    ref,
  ) {
    const ctx = useTabsContext("TabsContent")
    const selected = ctx.value === value
    if (!selected && !forceMount) return null

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${ctx.baseId}-panel-${value}`}
        aria-labelledby={`${ctx.baseId}-trigger-${value}`}
        hidden={!selected}
        tabIndex={0}
        className={cn("focus-visible:outline-none", className)}
        {...props}
      >
        {children}
      </div>
    )
  },
)
