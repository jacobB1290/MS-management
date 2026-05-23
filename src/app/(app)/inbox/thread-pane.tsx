"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, AlertTriangle, Plus, Loader2, X } from "lucide-react"
import { format, formatRelative } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatPhone, cn } from "@/lib/utils"
import {
  MEDIA_ACCEPT_ATTR,
  ACCEPTED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  isVideoUrl,
  uploadMedia,
} from "@/lib/media"
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
  const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const optedOut = Boolean(contact.sms_opted_out_at)
  const noPhone = !contact.phone

  // Sync local state when the parent feeds a fresh thread (URL `?c=` change).
  const [lastContactId, setLastContactId] = useState(contact.id)
  if (lastContactId !== contact.id) {
    setLastContactId(contact.id)
    setMessages(initialMessages)
    setBody("")
    setMedia(null)
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
                  m.body === incoming.body &&
                  m.media_url === incoming.media_url,
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

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file
    if (!file) return
    if (!ACCEPTED_MEDIA_TYPES.includes(file.type)) {
      toast.error("Unsupported file type. Use an image or short video.")
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast.error("File too large — 5 MB max for MMS.")
      return
    }
    setUploading(true)
    uploadMedia(file)
      .then(({ url }) => setMedia({ url, isVideo: file.type.startsWith("video/") }))
      .catch((err) =>
        toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => setUploading(false))
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if ((!text && !media) || sending || uploading || optedOut || noPhone) return
    setSending(true)

    // Optimistic: append a pending bubble immediately so the UI feels native.
    const sentMedia = media
    const tempId = `tmp_${crypto.randomUUID()}`
    const optimistic: OptimisticMessage = {
      id: tempId,
      contact_id: contact.id,
      direction: "out",
      body: text,
      media_url: sentMedia?.url ?? null,
      channel: sentMedia ? "mms" : "sms",
      twilio_sid: null,
      status: "sending",
      error: null,
      campaign_id: null,
      sent_by: null,
      num_segments: null,
      price: null,
      price_unit: null,
      created_at: new Date().toISOString(),
      _optimistic: true,
    }
    setMessages((cur) => [...cur, optimistic])
    setBody("")
    setMedia(null)

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contact.id,
          body: text,
          media_url: sentMedia?.url ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        // Roll the optimistic message back, restore the draft + attachment.
        setMessages((cur) => cur.filter((m) => m.id !== tempId))
        setBody(text)
        setMedia(sentMedia)
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
      setMedia(sentMedia)
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
            {media && (
              <div className="mb-2 relative inline-block">
                {media.isVideo ? (
                  <video
                    src={media.url}
                    className="h-20 rounded-md border border-ink-hairline"
                    muted
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={media.url}
                    alt="Attachment preview"
                    className="h-20 rounded-md border border-ink-hairline"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setMedia(null)}
                  aria-label="Remove attachment"
                  className="absolute -top-2 -right-2 inline-flex items-center justify-center h-6 w-6 rounded-pill bg-ink text-white shadow-sm"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <form onSubmit={handleSend} className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={MEDIA_ACCEPT_ATTR}
                className="hidden"
                onChange={onPickFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                aria-label="Attach photo or video"
                className="inline-flex items-center justify-center h-11 w-11 shrink-0 rounded-pill border border-ink-hairline text-ink-muted hover:bg-white active:bg-white transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
              </button>
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
              <Button type="submit" disabled={(!body.trim() && !media) || uploading} size="md">
                Send
              </Button>
            </form>
            <p className="mt-2 text-micro text-ink-faint">
              Press <span className="font-mono">⌘↵</span> to send · Tap + to attach a photo or short video
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
        {message.media_url &&
          (isVideoUrl(message.media_url) ? (
            <video
              src={message.media_url}
              controls
              className="rounded-md max-h-64 w-auto mb-2"
            />
          ) : (
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
          ))}
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
