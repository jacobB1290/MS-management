import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The console's one table voice. Campaigns and Audit each hand-rolled the same
 * white card + hairline grid with slightly different header styling; this is
 * the single source so they (and future tables) can't drift.
 *
 * Anatomy: `TableCard` is the white, rounded, h-scrollable shell; `Table` the
 * element; `Th` the column label (the same small-caps label voice as the
 * contacts section headers — labels everywhere speak one way); `Tr` the row
 * with the standard surface-tint hover; `Td` the cell.
 */
export function TableCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border border-ink-hairline bg-white",
        className,
      )}
      {...props}
    />
  )
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-small", className)} {...props} />
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-left text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint",
        className,
      )}
      {...props}
    />
  )
}

export function Tr({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-ink-hairline last:border-b-0 transition-colors hover:bg-surface",
        className,
      )}
      {...props}
    />
  )
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3", className)} {...props} />
}
