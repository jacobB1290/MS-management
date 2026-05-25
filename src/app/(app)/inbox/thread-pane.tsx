"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, AlertTriangle, Plus, Loader2, X, ChevronRight, RotateCcw } from "lucide-react"
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
  senderNames: Record<string, string>
}

/** Optimistic message rows are real Message shape but with a temp id and
 *  status='pending'; once the server returns the real row id, we swap. */
type OptimisticMessage = Message & { _optimistic?: boolean }

export function ThreadPane({
  contact: contactProp,
  initialMessages,
  currentUserId,
  senderNames,
}: ThreadPaneProps) {
  // Contact is held in state so realtime row updates (e.g. a STOP reply
  // flipping sms_opted_out_at) reflect in the thread immediately, without
  // re-navigating. Seeded from the server prop, resynced on thread switch.
  const [contact, setContact] = useState<Contact>(contactProp)
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
  const [lastContactId, setLastContactId] = useState(contactProp.id)
  if (lastContactId !== contactProp.id) {
    setLastContactId(contactProp.id)
    setContact(contactProp)
    setMessages(initialMessages)
    setBody("")
    setMedia(null)
  }

  // Realtime: new messages + status updates AND the contact row itself, so a
  // STOP reply (carrier opt-out) blocks the composer live.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`thread:${contactProp.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "contacts", filter: `id=eq.${contactProp.id}` },
        (payload) => {
          setContact((cur) => ({ ...cur, ...(payload.new as Contact) }))
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `contact_id=eq.${contactProp.id}` },
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
  }, [contactProp.id])

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
      toast.error("File too large. 5 MB max for MMS")
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

  // Core send path. `restoreComposerOnFail` is true for a fresh compose (so a
  // failed send hands the draft back to the editor) and false for a retry of
  // an already-failed bubble (where there's no draft to restore).
  async function dispatchSend(
    text: string,
    mediaUrl: string | null,
    isVideo: boolean,
    restoreComposerOnFail: boolean,
  ) {
    setSending(true)
    const tempId = `tmp_${crypto.randomUUID()}`
    const optimistic: OptimisticMessage = {
      id: tempId,
      contact_id: contact.id,
      direction: "out",
      body: text,
      media_url: mediaUrl,
      channel: mediaUrl ? "mms" : "sms",
      twilio_sid: null,
      status: "sending",
      error: null,
      campaign_id: null,
      sent_by: currentUserId,
      num_segments: null,
      price: null,
      price_unit: null,
      created_at: new Date().toISOString(),
      _optimistic: true,
    }
    setMessages((cur) => [...cur, optimistic])

    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, body: text, media_url: mediaUrl }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessages((cur) => cur.filter((m) => m.id !== tempId))
        if (restoreComposerOnFail) {
          setBody(text)
          setMedia(mediaUrl ? { url: mediaUrl, isVideo } : null)
        }
        toast.error(json.error === "opt_out" ? "Contact has opted out" : `Send failed: ${json.error}`)
      } else if (json.mock) {
        setMessages((cur) =>
          cur.map((m) => (m.id === tempId ? { ...m, status: "mocked" } : m)),
        )
        toast.message("Recorded without sending. Twilio isn’t configured yet")
      }
      // No router.refresh() — realtime + optimistic state already covers it.
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m.id !== tempId))
      if (restoreComposerOnFail) {
        setBody(text)
        setMedia(mediaUrl ? { url: mediaUrl, isVideo } : null)
      }
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if ((!text && !media) || sending || uploading || optedOut || noPhone) return
    const sentMedia = media
    setBody("")
    setMedia(null)
    await dispatchSend(text, sentMedia?.url ?? null, sentMedia?.isVideo ?? false, true)
  }

  async function handleRetry(msg: OptimisticMessage) {
    if (sending || optedOut || noPhone) return
    await dispatchSend(msg.body ?? "", msg.media_url, isVideoUrl(msg.media_url ?? ""), false)
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
            href={`/contacts/${contact.id}?from=inbox`}
            prefetch
            className="font-medium text-ink truncate hover:underline active:text-gold-dark flex items-center gap-1 w-fit max-w-full"
          >
            <span className="truncate">
              {contact.name ?? formatPhone(contact.phone) ?? contact.email ?? "Unknown"}
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-faint" />
          </Link>
          {/* Secondary line: only show when there's something *new* beyond the
              title — otherwise we end up with the phone number printed twice. */}
          {contact.name && (contact.phone || contact.email) ? (
            <p className="text-small text-ink-faint truncate">
              {contact.phone ? formatPhone(contact.phone) : contact.email}
            </p>
          ) : !contact.name ? (
            <Link
              href={`/contacts/${contact.id}/edit?from=inbox`}
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
        className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-8 py-6 space-y-4"
      >
        {messages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-ink-faint text-small">
              No messages yet. Start the conversation below.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onRetry={handleRetry}
            senderName={m.direction === "out" && m.sent_by ? senderNames[m.sent_by] ?? null : null}
          />
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
                href={`/contacts/${contact.id}/edit?from=inbox`}
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
                className="btn-icon-action disabled:opacity-50"
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

function MessageBubble({
  message,
  onRetry,
  senderName,
}: {
  message: OptimisticMessage
  onRetry: (message: OptimisticMessage) => void
  senderName: string | null
}) {
  const isOut = message.direction === "out"
  const time = useMemo(() => {
    return formatRelative(new Date(message.created_at), new Date())
  }, [message.created_at])
  const pending = message.status === "sending" || message._optimistic
  const failed =
    isOut && (message.status === "failed" || message.status === "undelivered")

  return (
    <div className={cn("flex flex-col", isOut ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] md:max-w-[72%] rounded-lg px-4 py-2.5 text-body leading-normal transition-opacity",
          isOut
            ? "bg-gold text-white rounded-br-sm"
            : "bg-white border border-ink-hairline text-ink rounded-bl-sm",
          failed && "ring-1 ring-danger/40",
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
          {isOut && senderName ? `${senderName} · ` : ""}
          {pending ? "Sending…" : time}
          {!pending && message.status && message.status !== "received" && (
            <span className="ml-2 capitalize">· {message.status}</span>
          )}
        </p>
      </div>
      {failed && (
        <button
          type="button"
          onClick={() => onRetry(message)}
          className="mt-1 inline-flex items-center gap-1 text-micro text-danger font-medium hover:underline active:opacity-70"
        >
          <RotateCcw size={11} /> Tap to retry
        </button>
      )}
    </div>
  )
}
