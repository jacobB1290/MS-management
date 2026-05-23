"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { Search, Tag, Check, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
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
    <div className="space-y-2.5">
      {/* Search inline with the primary action (passed in as children). */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <Input
            type="search"
            placeholder="Search contacts by name, phone, email"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit({ q })
            }}
            className="pl-9"
          />
        </div>
        {children}
      </div>

      {/* Tag filter: a small, secondary dropdown chip — not a full-width field. */}
      {tags.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 min-h-9 text-small transition-colors",
              tag
                ? "border-[color-mix(in_oklab,var(--gold)_45%,white)] bg-[color-mix(in_oklab,var(--gold)_12%,white)] text-gold-dark font-medium"
                : "border-ink-hairline bg-white text-ink-muted hover:text-ink",
            )}
          >
            <Tag size={13} />
            {tag || "All tags"}
            <ChevronDown size={13} className="text-ink-faint" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            <DropdownMenuItem onClick={() => pickTag("")}>
              <Check size={14} className={cn("shrink-0", tag ? "opacity-0" : "text-gold")} />
              All tags
            </DropdownMenuItem>
            {tags.map((t) => (
              <DropdownMenuItem key={t} onClick={() => pickTag(t)}>
                <Check size={14} className={cn("shrink-0", t === tag ? "text-gold" : "opacity-0")} />
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
