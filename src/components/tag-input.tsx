"use client"
import { useId, useMemo, useRef, useState } from "react"
import { X, Plus, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Reuse-first tag picker. Shows the existing tag vocabulary as a filterable
 * dropdown so staff pick a known tag (e.g. "neighborhood") instead of inventing
 * a near-duplicate; typing a brand-new value offers a "Create" affordance.
 * Selected tags render as removable chips. Submits as a hidden comma-joined
 * input named `name`, so server forms read it exactly like a text field.
 */
export function TagInput({
  id,
  name = "tags",
  defaultValue = [],
  suggestions = [],
  aiTags = [],
}: {
  id?: string
  name?: string
  defaultValue?: string[]
  suggestions?: string[]
  /** Tags the AI applied (marked so staff see what's unconfirmed). */
  aiTags?: string[]
}) {
  const [tags, setTags] = useState<string[]>(() => Array.from(new Set(defaultValue.filter(Boolean))))
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const aiSet = useMemo(() => new Set(aiTags), [aiTags])

  const norm = (s: string) => s.trim().toLowerCase()
  const selected = new Set(tags.map(norm))

  const matches = useMemo(() => {
    const q = norm(query)
    return Array.from(new Set(suggestions.map((s) => s.trim()).filter(Boolean)))
      .filter((s) => !selected.has(norm(s)) && (q === "" || norm(s).includes(q)))
      .sort()
      .slice(0, 8)
  }, [suggestions, query, tags]) // eslint-disable-line react-hooks/exhaustive-deps

  const canCreate = norm(query).length > 0 && !selected.has(norm(query)) && !matches.some((m) => norm(m) === norm(query))

  function add(tag: string) {
    const t = tag.trim()
    if (!t || selected.has(norm(t))) {
      setQuery("")
      return
    }
    setTags((cur) => [...cur, t])
    setQuery("")
    inputRef.current?.focus()
  }

  function remove(tag: string) {
    setTags((cur) => cur.filter((t) => t !== tag))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      if (matches.length > 0 && !canCreate) add(matches[0])
      else if (query.trim()) add(query)
    } else if (e.key === "Backspace" && query === "" && tags.length > 0) {
      remove(tags[tags.length - 1])
    }
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={tags.join(",")} />

      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-ink-hairline bg-white px-2 py-2 min-h-11 focus-within:border-gold transition-colors"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-pill bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] pl-2 pr-1 py-0.5 text-label font-medium text-ink-muted"
          >
            {aiSet.has(t) && <Sparkles size={10} className="text-gold shrink-0" aria-hidden />}
            {t}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); remove(t) }}
              aria-label={`Remove ${t}`}
              className="inline-flex items-center justify-center h-4 w-4 rounded-pill text-ink-faint hover:text-ink hover:bg-ink-hairline"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          aria-controls={listId}
          placeholder={tags.length === 0 ? "Add a tag…" : ""}
          className="flex-1 min-w-[8ch] bg-transparent px-1 py-1 text-body text-ink outline-none placeholder:text-ink-faint"
        />
      </div>

      {open && (matches.length > 0 || canCreate) && (
        <ul
          id={listId}
          className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-md border border-ink-hairline bg-surface py-1 shadow-[var(--shadow-md)]"
        >
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(m) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink hover:bg-white"
              >
                {aiSet.has(m) && <Sparkles size={11} className="text-gold shrink-0" aria-hidden />}
                <span className="flex-1 truncate">{m}</span>
                <span className="text-micro text-ink-faint">existing</span>
              </button>
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(query) }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-body text-ink hover:bg-white",
                  matches.length > 0 && "border-t border-ink-hairline",
                )}
              >
                <Plus size={13} className="text-gold shrink-0" aria-hidden />
                <span className="flex-1 truncate">Create “{query.trim()}”</span>
                <span className="text-micro text-ink-faint">new</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
