"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

export function ContactsSearch({
  initialQuery,
  initialTag,
}: {
  initialQuery: string
  initialTag: string
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
    <div className="flex flex-col md:flex-row gap-2">
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
      <Input
        type="text"
        placeholder="Filter by tag"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit({ tag })
        }}
        className="md:max-w-[200px]"
      />
    </div>
  )
}
