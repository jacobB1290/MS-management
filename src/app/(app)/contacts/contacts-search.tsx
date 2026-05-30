"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { Search, Tag, Check } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export function ContactsSearch({
  initialQuery,
  initialTag,
  tags,
  children,
}: {
  initialQuery: string
  initialTag: string
  tags: string[]
  children?: ReactNode
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [q, setQ] = useState(initialQuery)
  const [tag, setTag] = useState(initialTag)
  const [, startTransition] = useTransition()

  function commit(next: { q?: string; tag?: string }) {
    const sp = new URLSearchParams(params.toString())
    if (next.q !== undefined) {
      if (next.q) sp.set("q", next.q)
      else sp.delete("q")
    }
    if (next.tag !== undefined) {
      if (next.tag) sp.set("tag", next.tag)
      else sp.delete("tag")
    }
    startTransition(() => router.replace(`/contacts?${sp.toString()}`))
  }

  function pickTag(value: string) {
    setTag(value)
    commit({ tag: value })
  }

  return (
    <div className="flex items-center gap-2">
      {/* Tag filter folded into one dropdown button, left of the search — the
          reply-bar layout (round button, rounded field, round action). */}
      {tags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Filter by tag"
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border transition-colors",
              tag
                ? "border-gold bg-[color-mix(in_oklab,var(--gold)_12%,white)] text-gold-dark"
                : "border-ink-hairline bg-white text-ink-muted hover:text-ink",
            )}
          >
            <Tag size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto min-w-[180px]">
            <DropdownMenuLabel>Tag</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => pickTag("")}>
              <span className="flex-1">All tags</span>
              <Check size={14} className={cn("shrink-0", tag ? "opacity-0" : "text-gold")} />
            </DropdownMenuItem>
            {tags.map((t) => (
              <DropdownMenuItem key={t} onClick={() => pickTag(t)}>
                <span className="flex-1">{t}</span>
                <Check size={14} className={cn("shrink-0", t === tag ? "text-gold" : "opacity-0")} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="relative flex-1">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
        />
        <Input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search contacts"
          placeholder="Search contacts by name, phone, email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit({ q })
          }}
          className="pl-9 rounded-pill"
        />
      </div>
      {children}
    </div>
  )
}
