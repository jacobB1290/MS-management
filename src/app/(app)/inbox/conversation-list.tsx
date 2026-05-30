"use client"
import { memo, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { Search, ListFilter, Check, Mail } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { NewMessageDialog } from "./new-message-dialog"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { cn, formatPhone } from "@/lib/utils"
import { INBOX_SEGMENTS, SEGMENT_META, isInboxCategory, type Segment } from "@/lib/inbox-segments"
import type { Tables } from "@/lib/database.types"

type Conversation = Pick<
  Tables<"contact_summary">,
  "id" | "name" | "phone" | "email" | "tags" |
  "sms_opted_out_at" | "email_unsubscribed_at" | "is_member" |
  "inbox_category" | "inbox_status" |
  "last_message_at" | "last_message_body" | "last_message_direction" |
  "last_message_channel" | "message_count"
>

/** A conversation needs a reply when their message is the last one AND we can
 *  still text them (an opted-out contact can't be messaged). Single definition,
 *  shared by the per-segment counts and the row dot. */
function isAwaitingReply(c: Conversation): boolean {
  return c.last_message_direction === "in" && !c.sms_opted_out_at
}

/** Whether a conversation belongs to a segment. "all" is unfiltered (General is
 *  authoritative — nothing is ever hidden from it); "members" is the orthogonal
 *  is_member overlay; the rest match the conversation's category. */
function inSegment(c: Conversation, segment: Segment): boolean {
  if (segment === "all") return true
  if (segment === "members") return Boolean(c.is_member)
  return (c.inbox_category ?? "general") === segment
}

/** One conversation row. Memoized so a realtime update to a single conversation
 *  (or any message INSERT that bumps one row) re-renders only that row instead
 *  of reformatting the relative time and re-rendering all ~200 list rows. The
 *  parent passes stable refs (unchanged rows keep their object identity across
 *  setItems) and a stable onSelect, so memo skips untouched rows. */
const ConversationRow = memo(function ConversationRow({
  c,
  active,
  onSelect,
}: {
  c: Conversation
  active: boolean
  onSelect: (id: string) => void
}) {
  const awaitingReply = isAwaitingReply(c)
  const lastAt = c.last_message_at
    ? formatDistanceToNow(new Date(c.last_message_at), { addSuffix: false })
    : null
  return (
    <li>
      {/* A real prefetching Link (not a button): prefetch pulls the full thread
          — messages included — as the row enters the viewport, so the FIRST tap
          opens instantly with no load, matching the contacts list. scroll={false}
          keeps the list scroll position; onClick flips the active row
          optimistically. */}
      <Link
        href={`/inbox?c=${c.id}`}
        prefetch
        scroll={false}
        onClick={() => c.id && onSelect(c.id)}
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
          {/* Preview + compliance flags share one line so every row is the
              same height (avatar + two lines). STOP/UNSUB stay inline. */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className={cn("text-small truncate min-w-0 flex-1", awaitingReply ? "text-ink" : "text-ink-muted")}>
              {c.last_message_channel === "email" && (
                <Mail size={12} className="inline-block mr-1 -mt-0.5 text-ink-faint" aria-label="Email" />
              )}
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
            {c.sms_opted_out_at && <Badge variant="warning" className="shrink-0">STOP</Badge>}
            {c.email_unsubscribed_at && <Badge variant="muted" className="shrink-0">UNSUB</Badge>}
          </div>
        </div>
      </Link>
    </li>
  )
})

interface ConversationListProps {
  conversations: Conversation[]
  selectedId?: string
}

export function ConversationList({
  conversations: initial,
  selectedId,
}: ConversationListProps) {
  const router = useRouter()
  // Optimistic selection: a tap flips the active row immediately, ahead of the
  // route change, so the highlight never lags the navigation. We follow the
  // server's selection whenever it actually changes (back button, deep link),
  // but a fresh tap stays ahead of it without being reverted mid-navigation.
  const [optimisticId, setOptimisticId] = useState<string | undefined>(selectedId)
  const [lastServerId, setLastServerId] = useState<string | undefined>(selectedId)
  if (selectedId !== lastServerId) {
    setLastServerId(selectedId)
    setOptimisticId(selectedId)
  }
  const activeId = optimisticId ?? selectedId

  const [query, setQuery] = useState("")
  const [segment, setSegment] = useState<Segment>("all")
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
              last_message_channel: m.channel,
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
        { event: "UPDATE", schema: "public", table: "contacts" },
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
              is_member: c.is_member,
              inbox_category: c.inbox_category,
              inbox_status: c.inbox_status,
            }
            return next
          })
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "contacts" },
        (payload) => {
          // A deleted contact must drop out of the list in every open tab, not
          // just the one that triggered it. DELETE payloads carry only `old`.
          const deletedId = (payload.old as { id?: string }).id
          if (!deletedId) return
          setItems((cur) => cur.filter((x) => x.id !== deletedId))
        },
      )
      .subscribe()
    // Realtime is live-only and drops while the tab is backgrounded; reconcile
    // the list on refocus so anything missed while away isn't stuck until a
    // manual refresh. A quick glance away (< 2s) keeps the socket alive and the
    // live handlers above already covered it, so skip the server round-trip and
    // only refresh after a real absence — coming back stays instant.
    let hiddenAt = 0
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt > 2000) {
        hiddenAt = 0
        router.refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      void supabase.removeChannel(channel)
    }
  }, [router])

  const filtered = useMemo(() => {
    const base = items.filter((c) => inSegment(c, segment))
    if (!query.trim()) return base
    const q = query.toLowerCase()
    // Match phone numbers on digits only, so "(208) 473" finds the stored
    // E.164 form just like a bare "208473" would.
    const qDigits = query.replace(/\D/g, "")
    return base.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        (qDigits.length >= 2 && c.phone?.replace(/\D/g, "").includes(qDigits)),
    )
  }, [items, query, segment])

  // Per-segment "needs a reply" counts. These prove nothing is hidden: the
  // category segments (Prayer/Questions/Outreach + whatever stays in General)
  // partition the inbox, so their counts sum to the General count. Members is
  // an overlay shown alongside. Only segments with a waiting reply show a count.
  const segmentCounts = useMemo(() => {
    const counts: Record<Segment, number> = {
      all: 0,
      members: 0,
      prayer: 0,
      question: 0,
      outreach: 0,
    }
    for (const c of items) {
      if (!isAwaitingReply(c)) continue
      counts.all += 1
      if (c.is_member) counts.members += 1
      const cat = c.inbox_category ?? "general"
      if (isInboxCategory(cat) && cat !== "general") counts[cat] += 1
    }
    return counts
  }, [items])

  return (
    <>
      {/* Sticky header: stays put while the conversation list scrolls
          beneath it on mobile. Search sits inline with the compose action;
          the page name already lives in the top bar / sidebar. */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-ink-hairline bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85 z-10">
        <div className="flex items-center gap-2">
          {/* Segment filter folded into one dropdown, left of the search — the
              reply-bar layout (round button, rounded field, round action). The
              per-segment awaiting-reply counts move into the menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Filter conversations by segment"
              className={cn(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border transition-colors",
                segment !== "all"
                  ? "border-gold bg-[color-mix(in_oklab,var(--gold)_12%,white)] text-gold-dark"
                  : "border-ink-hairline bg-white text-ink-muted hover:text-ink",
              )}
            >
              <ListFilter size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
              <DropdownMenuLabel>Segment</DropdownMenuLabel>
              {INBOX_SEGMENTS.map((seg) => {
                const count = segmentCounts[seg]
                return (
                  <DropdownMenuItem key={seg} onClick={() => setSegment(seg)} closeOnSelect>
                    <span className="flex-1">{SEGMENT_META[seg].label}</span>
                    {count > 0 && (
                      <span className="text-micro font-semibold text-gold-dark">{count}</span>
                    )}
                    <Check
                      size={14}
                      className={cn("shrink-0", seg === segment ? "text-gold" : "opacity-0")}
                    />
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

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
              className="pl-9 text-small rounded-pill"
            />
          </div>
          <NewMessageDialog />
        </div>
      </div>

      <ol className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar divide-y divide-ink-hairline">
        {filtered.length === 0 && (
          <li className="px-5 py-12 text-center text-ink-faint text-small">
            {query
              ? "No matches"
              : segment === "all"
                ? "No conversations yet"
                : `Nothing in ${SEGMENT_META[segment].label} yet`}
          </li>
        )}

        {filtered.map((c) => (
          <ConversationRow
            key={c.id}
            c={c}
            active={c.id === activeId}
            onSelect={setOptimisticId}
          />
        ))}
      </ol>
    </>
  )
}
