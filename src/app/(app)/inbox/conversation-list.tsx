"use client"
import Link from "next/link"
import { useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Search, Plus } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn, formatPhone } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

type Conversation = Pick<
  Tables<"contact_summary">,
  "id" | "name" | "phone" | "email" | "tags" |
  "sms_opted_out_at" | "email_unsubscribed_at" |
  "last_message_at" | "last_message_body" | "last_message_direction" |
  "message_count"
>

interface ConversationListProps {
  conversations: Conversation[]
  selectedId?: string
}

export function ConversationList({
  conversations,
  selectedId,
}: ConversationListProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    if (!query.trim()) return conversations
    const q = query.toLowerCase()
    return conversations.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q),
    )
  }, [conversations, query])

  return (
    <>
      <div className="px-4 pt-5 pb-3 border-b border-ink-hairline">
        <div className="flex items-center justify-between mb-3">
          <p className="font-display text-heading text-ink">Inbox</p>
          <Link
            href="/contacts/new"
            className="inline-flex items-center justify-center h-11 w-11 rounded-pill bg-white border border-ink-hairline text-ink hover:bg-bg transition-colors"
            aria-label="New contact"
          >
            <Plus size={16} />
          </Link>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none"
          />
          <Input
            type="search"
            placeholder="Search by name, phone, email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 text-small"
          />
        </div>
      </div>

      <ol className="flex-1 overflow-y-auto no-scrollbar divide-y divide-ink-hairline">
        {filtered.length === 0 && (
          <li className="px-5 py-12 text-center text-ink-faint text-small">
            {query ? "No matches." : "No conversations yet."}
          </li>
        )}

        {filtered.map((c) => {
          const active = c.id === selectedId
          const lastAt = c.last_message_at
            ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })
            : null
          return (
            <li key={c.id}>
              <Link
                href={`/inbox?c=${c.id}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3.5 transition-colors",
                  active
                    ? "bg-white shadow-[inset_3px_0_0_var(--gold)]"
                    : "hover:bg-white/60",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Avatar name={c.name ?? c.phone ?? c.email} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-ink truncate">
                      {c.name ?? formatPhone(c.phone) ?? c.email ?? "Unknown"}
                    </p>
                    {lastAt && (
                      <span
                        data-dynamic
                        className="text-micro text-ink-faint shrink-0"
                      >
                        {lastAt}
                      </span>
                    )}
                  </div>
                  <p className="text-small text-ink-muted truncate mt-0.5">
                    {c.last_message_body ? (
                      <>
                        {c.last_message_direction === "out" && (
                          <span className="text-ink-faint">You: </span>
                        )}
                        {c.last_message_body}
                      </>
                    ) : (
                      <span className="text-ink-faint">
                        {c.phone ? formatPhone(c.phone) : c.email ?? "No messages yet"}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 min-h-[18px]">
                    {c.sms_opted_out_at && <Badge variant="warning">STOP</Badge>}
                    {c.email_unsubscribed_at && <Badge variant="muted">UNSUB</Badge>}
                  </div>
                </div>
              </Link>
            </li>
          )
        })}
      </ol>
    </>
  )
}
