"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { splitNoteLines, joinNoteLines } from "@/lib/notes"
import { Textarea } from "@/components/ui/textarea"
import { MOTION_MEDIUM_MS, exitDurationMs } from "@/lib/motion"

/**
 * Bullet-list editor for a contact's notes — the human half of the AI+staff
 * memory. Each durable fact is its own point: staff add a point, edit any
 * point inline, or remove one, and the background AI merge adds its own points
 * to the same list (one fact per line; see src/lib/notes.ts). This is what
 * makes the "AI adds a point, you add a point" flow legible instead of both
 * editing one paragraph.
 *
 * Two consumption modes, both driven by the same internal list state:
 *   - `name`     → renders a hidden input so a plain server <form> reads it.
 *   - `onChange` → reports the joined value so a controlled save flow (the inbox
 *                  panel) can PATCH it.
 * The stored value always includes the in-progress "add" draft, so a point
 * typed but not yet committed is never lost on submit/save.
 *
 * Motion: adding a point unfolds it in and removing folds it away (a grid-rows
 * height collapse plus opacity, compositor-friendly); the global
 * prefers-reduced-motion rule settles both to the end state.
 */

type Row = { id: number; text: string }

export function NotesEditor({
  defaultValue,
  name,
  onChange,
  autoFocusAdd = false,
  className,
}: {
  defaultValue?: string | null
  /** When set, a hidden input of this name carries the joined value for a form. */
  name?: string
  /** Controlled readout of the joined notes string (fires on every change). */
  onChange?: (text: string) => void
  /** Focus the add-a-point field on mount (used when opening the inbox editor). */
  autoFocusAdd?: boolean
  className?: string
}) {
  const idRef = useRef(0)
  const nextId = useCallback(() => (idRef.current += 1), [])

  const [rows, setRows] = useState<Row[]>(() =>
    splitNoteLines(defaultValue).map((text) => ({ id: nextId(), text })),
  )
  // Rows present at first mount replace the already-settled view, so they don't
  // animate in; only points added afterward unfold.
  const initialIds = useRef(new Set(rows.map((r) => r.id)))
  const [exiting, setExiting] = useState<ReadonlySet<number>>(() => new Set())
  const [draft, setDraft] = useState("")
  const addRef = useRef<HTMLTextAreaElement>(null)

  // Stored value = committed points + the in-progress draft, so nothing is lost
  // when the form submits / the panel saves mid-type.
  const joined = joinNoteLines([...rows.map((r) => r.text), draft])

  useEffect(() => {
    onChange?.(joined)
  }, [joined, onChange])

  useEffect(() => {
    if (autoFocusAdd) addRef.current?.focus()
  }, [autoFocusAdd])

  const commitDraft = useCallback(() => {
    const text = draft.replace(/[\r\n]+/g, " ").trim()
    setDraft("")
    if (!text) return
    setRows((cur) => [...cur, { id: nextId(), text }])
    addRef.current?.focus()
  }, [draft, nextId])

  const updateRow = useCallback((id: number, text: string) => {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, text } : r)))
  }, [])

  const removeRow = useCallback((id: number) => {
    setExiting((cur) => new Set(cur).add(id))
    window.setTimeout(() => {
      setRows((cur) => cur.filter((r) => r.id !== id))
      setExiting((cur) => {
        const next = new Set(cur)
        next.delete(id)
        return next
      })
    }, exitDurationMs(MOTION_MEDIUM_MS))
  }, [])

  return (
    <div className={cn(className)}>
      {name && <input type="hidden" name={name} value={joined} />}

      <ul>
        {rows.map((row) => (
          <NoteRow
            key={row.id}
            text={row.text}
            animateIn={!initialIds.current.has(row.id)}
            exiting={exiting.has(row.id)}
            onChangeText={(t) => updateRow(row.id, t)}
            onRemove={() => removeRow(row.id)}
            onEnter={() => addRef.current?.focus()}
          />
        ))}
      </ul>

      {/* Add-a-point row. Enter commits and keeps focus here for rapid entry. */}
      <div className="flex items-start gap-2.5 pt-1.5">
        <Plus aria-hidden size={15} className="mt-[0.55rem] shrink-0 text-gold" />
        <Textarea
          ref={addRef}
          variant="quiet"
          autoGrow
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              commitDraft()
            }
          }}
          onBlur={commitDraft}
          placeholder="Add a note…"
          aria-label="Add a note"
          className="min-h-0 flex-1 py-1.5 text-body"
        />
      </div>
    </div>
  )
}

function NoteRow({
  text,
  animateIn,
  exiting,
  onChangeText,
  onRemove,
  onEnter,
}: {
  text: string
  animateIn: boolean
  exiting: boolean
  onChangeText: (text: string) => void
  onRemove: () => void
  onEnter: () => void
}) {
  // "enter": hold the collapsed/transparent start frame, then release to "open"
  // on the next paint so the transition runs. "exit" is parent-driven.
  const [entering, setEntering] = useState(animateIn)
  useLayoutEffect(() => {
    if (!entering) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntering(false))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
    // Run once on mount; `entering` only ever transitions true → false here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const state = exiting ? "exit" : entering ? "enter" : "open"

  return (
    <li className="note-row" data-state={state}>
      <div className="note-row-inner flex items-start gap-2.5 py-1">
        <span
          aria-hidden
          className="mt-[0.62rem] h-[5px] w-[5px] shrink-0 rounded-full bg-gold/70"
        />
        <Textarea
          variant="quiet"
          autoGrow
          rows={1}
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onEnter()
            }
          }}
          aria-label="Edit note"
          className="min-h-0 flex-1 py-1 text-body"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove note"
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-ink-faint transition-colors hover:bg-ink-hairline hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </li>
  )
}
