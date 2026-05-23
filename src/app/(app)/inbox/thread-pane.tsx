"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import { format, formatRelative } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatPhone, cn } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

type Contact = Tables<"contacts">
type Message = Tables<"messages">

interface ThreadPaneProps {
  contact: Contact
  initialMessages: Message[]
  currentUserId: string
}

/** Optimistic message rows are real Message shape but with a temp id and
 *  status='pending'; once the server returns the real row id, we swap. */
type OptimisticMessage = Message & { _optimistic?: boolean }

export function ThreadPane({ contact, initialMessages }: ThreadPaneProps) {
  const [messages, setMessages] = useState<OptimisticMessage[]>(initialMessages)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const optedOut = Boolean(contact.sms_opted_out_at)
  const noPhone = !contact.phone

  // Sync local state when the parent feeds a fresh thread (URL `?c=` change).
  const [lastContactId, setLastContactId] = useState(contact.id)
  if (lastContactId !== contact.id) {
    setLastContactId(contact.id)
    setMessages(initialMessages)
    setBody("")
  }

  // Realtime subscription on inbound + status updates for this contact.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`messages:${contact.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `contact_id=eq.${contact.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setMessages((cur) => {
              const incoming = payload.new as Message
              if (cur.some((m) => m.id === incoming.id)) return cur
              // Swap a matching pending optimistic row with the real one
              // (matched on body since temp ids are random).
              const swapIdx = cur.findIndex(
                (m) =>
                  m._optimistic &&
                  m.direction === "out" &&
                  m.body === incoming.body,
              )
              if (swapIdx >= 0) {
                const next = cur.slice()
                next[swapIdx] = incoming
                return next
              }
              return [...cur, incoming]
            })
          } else if (payload.eventType === "UPDATE") {
            setMessages((cur) =>
              cur.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m)),
            )
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [contact.id])

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || sending || optedOut || noPhone) return
    setSending(true)

    // Optimistic: append a pending bubble immediately so the UI feels native.
    const tempId = `tmp_${crypto.randomUUID()}`
    const optimistic: OptimisticMessage = {
      id: tempId,
      contact_id: contact.id,
      direction: "out",
      body: text,
      media_url: null,
      channel: "sms",
      twilio_sid: null,
      status: "sending",
      error: null,
      campaign_id: null,
      sent_by: null,
      created_at: new Date().toISOString(),
      _optimistic: true,
    }
    setMessages((cur) => [...cur, optimistic])
    setBody("")

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, body: text }),
      })
      const json = await res.json()
      if (!res.ok) {
        // Roll the optimistic message back, restore the textarea.
        setMessages((cur) => cur.filter((m) => m.id !== tempId))
        setBody(text)
        toast.error(json.error === "opt_out" ? "Contact has opted out." : `Send failed: ${json.error}`)
      } else if (json.mock) {
        // Mark the optimistic row as 'mocked' visibly until realtime swaps it.
        setMessages((cur) =>
          cur.map((m) => (m.id === tempId ? { ...m, status: "mocked" } : m)),
        )
        toast.message("Recorded without sending — Twilio not configured yet.")
      }
      // No router.refresh() — realtime + optimistic state already covers it.
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m.id !== tempId))
      setBody(text)
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <header className="shrink-0 flex items-center gap-3 px-4 md:px-6 py-3 border-b border-ink-hairline bg-bg/95 backdrop-blur">
        <Link
          href="/inbox"
          prefetch
          className="md:hidden inline-flex items-center justify-center h-11 w-11 -ml-2 rounded-pill hover:bg-white transition-colors"
          aria-label="Back to inbox"
        >
          <ArrowLeft size={18} />
        </Link>
        <Avatar name={contact.name ?? contact.phone} size="md" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/contacts/${contact.id}`}
            prefetch
            className="font-medium text-ink truncate hover:underline block"
          >
            {contact.name ?? formatPhone(contact.phone) ?? contact.email ?? "Unknown"}
          </Link>
          {/* Secondary line: only show when there's something *new* beyond the
              title — otherwise we end up with the phone number printed twice. */}
          {contact.name && (contact.phone || contact.email) ? (
            <p className="text-small text-ink-faint truncate">
              {contact.phone ? formatPhone(contact.phone) : contact.email}
            </p>
          ) : !contact.name ? (
            <Link
              href={`/contacts/${contact.id}/edit`}
              prefetch
              className="text-small text-gold hover:underline truncate block"
            >
              Add name
            </Link>
          ) : null}
        </div>
        {optedOut && (
          <Badge variant="warning" className="shrink-0">
            Opted out
          </Badge>
        )}
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4"
      >
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-ink-faint text-small">
              No messages yet. Start the conversation below.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <footer className="shrink-0 border-t border-ink-hairline bg-bg/95 backdrop-blur px-4 md:px-6 py-3 md:py-4">
        {optedOut ? (
          <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,white)] bg-[color-mix(in_oklab,var(--color-warning)_8%,white)] px-3 py-3 text-small text-ink">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <p>
              This contact has opted out of SMS. To message them again, they
              must reply{" "}
              <span className="font-mono font-semibold">START</span> to your number.
            </p>
          </div>
        ) : noPhone ? (
          <div className="flex items-start gap-2 rounded-md border border-ink-hairline bg-white px-3 py-3 text-small text-ink-muted">
            <AlertTriangle size={16} className="text-ink-faint shrink-0 mt-0.5" />
            <p>
              No phone number on file.{" "}
              <Link
                href={`/contacts/${contact.id}/edit`}
                prefetch
                className="text-gold underline underline-offset-2"
              >
                Add one
              </Link>{" "}
              to send SMS.
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleSend} className="flex items-end gap-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a reply…"
                rows={2}
                autoGrow
                className="flex-1 min-h-[44px] max-h-40 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSend(e)
                  }
                }}
              />
              <Button type="submit" disabled={!body.trim()} size="md">
                Send
              </Button>
            </form>
            <p className="mt-2 text-micro text-ink-faint">
              Press <span className="font-mono">⌘↵</span> to send · Replies route to the same thread
            </p>
          </>
        )}
      </footer>
    </>
  )
}

function MessageBubble({ message }: { message: OptimisticMessage }) {
  const isOut = message.direction === "out"
  const time = useMemo(() => {
    return formatRelative(new Date(message.created_at), new Date())
  }, [message.created_at])
  const pending = message.status === "sending" || message._optimistic

  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] md:max-w-[60%] rounded-lg px-4 py-2.5 text-body leading-normal transition-opacity",
          isOut
            ? "bg-gold text-white rounded-br-sm"
            : "bg-white border border-ink-hairline text-ink rounded-bl-sm",
          pending && "opacity-70",
        )}
      >
        {message.media_url && (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className="block mb-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={message.media_url}
              alt="Attachment"
              className="rounded-md max-h-64 w-auto"
            />
          </a>
        )}
        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        <p
          data-dynamic
          className={cn(
            "mt-1 text-micro",
            isOut ? "text-white/70" : "text-ink-faint",
          )}
          title={format(new Date(message.created_at), "PPpp")}
        >
          {pending ? "Sending…" : time}
          {!pending && message.status && message.status !== "received" && (
            <span className="ml-2 capitalize">· {message.status}</span>
          )}
        </p>
      </div>
    </div>
  )
}
