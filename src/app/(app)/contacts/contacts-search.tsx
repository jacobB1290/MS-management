"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

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

  return (
    <div className="space-y-2">
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

      {/* Tag filter: a dropdown of existing tags, not free text. */}
      <select
        aria-label="Filter by tag"
        value={tag}
        onChange={(e) => {
          setTag(e.target.value)
          commit({ tag: e.target.value })
        }}
        className="block w-full md:max-w-[240px] rounded-md border border-ink-hairline bg-white px-3 py-2.5 text-small text-ink min-h-11"
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  )
}
