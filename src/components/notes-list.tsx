import { cn } from "@/lib/utils"
import { splitNoteLines } from "@/lib/notes"

/**
 * Read-only rendering of a contact's notes as a bullet list — one durable fact
 * per bullet, marked with a small gold dot. Server-safe (no "use client"), so
 * the same component renders on the contact detail page and inside the inbox
 * contact panel's view state. Returns null when there is nothing to show, so
 * callers gate the surrounding label on a non-empty value the same way.
 */
export function NotesList({
  text,
  dense = false,
  className,
}: {
  text: string | null | undefined
  /** Quieter `--text-small` rhythm for the inbox panel; default is `--text-body`. */
  dense?: boolean
  className?: string
}) {
  const lines = splitNoteLines(text)
  if (lines.length === 0) return null

  return (
    <ul className={cn("space-y-1.5", className)}>
      {lines.map((line, i) => (
        <li
          key={`${i}-${line}`}
          className={cn(
            "flex gap-2.5 text-ink-muted leading-normal",
            dense ? "text-small" : "text-body",
          )}
        >
          <span
            aria-hidden
            className="mt-[0.5em] h-[5px] w-[5px] shrink-0 rounded-full bg-gold/70"
          />
          <span className="min-w-0 break-words">{line}</span>
        </li>
      ))}
    </ul>
  )
}
