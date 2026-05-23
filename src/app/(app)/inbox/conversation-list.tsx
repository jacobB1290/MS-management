"use client"
import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { Search } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { NewMessageDialog } from "./new-message-dialog"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
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
  conversations: initial,
  selectedId,
}: ConversationListProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // Optimistic selection: flip immediately so the active row paints before
  // the route navigation finishes.
  const [optimisticId, setOptimisticId] = useState<string | undefined>(selectedId)
  if (selectedId !== undefined && selectedId !== optimisticId && !pending) {
    // Server caught up — sync.
    setOptimisticId(selectedId)
  }
  const activeId = optimisticId ?? selectedId

  const [query, setQuery] = useState("")
  const [items, setItems] = useState<Conversation[]>(initial)

  // Reseed when the parent provides a fresh server-side snapshot.
  const [seedSig, setSeedSig] = useState(initial.length)
  if (initial.length !== seedSig) {
    setSeedSig(initial.length)
    setItems(initial)
  }

  // Realtime: new inbound + outbound messages bump conversations to top
  // without requiring a navigation/refresh.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel("inbox:conversation-list")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Tables<"messages">
          setItems((cur) => {
            const idx = cur.findIndex((c) => c.id === m.contact_id)
            if (idx < 0) {
              // New contact we don't have in the list yet — trigger a refresh
              // so the server re-fetches via contact_summary.
              router.refresh()
              return cur
            }
            const updated: Conversation = {
              ...cur[idx],
              last_message_at: m.created_at,
              last_message_body: m.body,
              last_message_direction: m.direction,
              message_count: (cur[idx].message_count ?? 0) + 1,
            }
            const next = cur.slice()
            next.splice(idx, 1)
            return [updated, ...next]
          })
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contacts" },
        (payload) => {
          const c = payload.new as Tables<"contacts">
          setItems((cur) => {
            const idx = cur.findIndex((x) => x.id === c.id)
            if (idx < 0) return cur
            const next = cur.slice()
            next[idx] = {
              ...next[idx],
              name: c.name,
              phone: c.phone,
              email: c.email,
              tags: c.tags,
              sms_opted_out_at: c.sms_opted_out_at,
              email_unsubscribed_at: c.email_unsubscribed_at,
            }
            return next
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [router])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    // Match phone numbers on digits only, so "(208) 473" finds the stored
    // E.164 form just like a bare "208473" would.
    const qDigits = query.replace(/\D/g, "")
    return items.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        (qDigits.length >= 2 && c.phone?.replace(/\D/g, "").includes(qDigits)),
    )
  }, [items, query])

  function selectConversation(id: string) {
    setOptimisticId(id)
    startTransition(() => {
      router.push(`/inbox?c=${id}`, { scroll: false })
    })
  }

  return (
    <>
      {/* Sticky header: stays put while the conversation list scrolls
          beneath it on mobile. Search sits inline with the compose action;
          the page name already lives in the top bar / sidebar. */}
      <div className="shrink-0 px-4 pt-5 pb-3 border-b border-ink-hairline bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85 z-10">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
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
          <NewMessageDialog />
        </div>
      </div>

      <ol className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar divide-y divide-ink-hairline">
        {filtered.length === 0 && (
          <li className="px-5 py-12 text-center text-ink-faint text-small">
            {query ? "No matches" : "No conversations yet"}
          </li>
        )}

        {filtered.map((c) => {
          const active = c.id === activeId
          // Needs a reply: their message is the last one in the thread AND we
          // can still reply. An opted-out (STOP) contact can't be messaged, so
          // no dot — it would just be a task you can't action.
          const awaitingReply = c.last_message_direction === "in" && !c.sms_opted_out_at
          const lastAt = c.last_message_at
            ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })
            : null
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => c.id && selectConversation(c.id)}
                onMouseEnter={() => c.id && router.prefetch(`/inbox?c=${c.id}`)}
                className={cn(
                  "w-full text-left flex items-center gap-2.5 px-4 py-3.5 transition-colors",
                  active
                    ? "bg-white shadow-[inset_3px_0_0_var(--gold)]"
                    : "hover:bg-white/60 active:bg-white/60",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className="w-2 shrink-0 flex justify-center" aria-hidden={!awaitingReply}>
                  {awaitingReply && (
                    <span className="h-2.5 w-2.5 rounded-pill bg-gold" aria-label="Awaiting reply" />
                  )}
                </span>
                <Avatar name={c.name ?? c.phone ?? c.email} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("truncate", awaitingReply ? "font-semibold text-ink" : "font-medium text-ink")}>
                      {c.name ?? formatPhone(c.phone) ?? c.email ?? "Unknown"}
                    </p>
                    {lastAt && (
                      <span
                        data-dynamic
                        className={cn("text-micro shrink-0", awaitingReply ? "text-gold-dark font-medium" : "text-ink-faint")}
                      >
                        {lastAt}
                      </span>
                    )}
                  </div>
                  <p className={cn("text-small truncate mt-0.5", awaitingReply ? "text-ink" : "text-ink-muted")}>
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
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}
