"use client"
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { InboxNavContext } from "./inbox-frame"
import { ArrowLeft, AlertTriangle, Plus, Loader2, X, ChevronRight, RotateCcw, Sparkles, Clock, Info, ArrowUp, Image as ImageIcon, Mail, MessageSquare, MailX, Paperclip, FileText, Pencil, Eye } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { format, formatRelative } from "date-fns"
import { toast } from "sonner"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { formatPhone, cn } from "@/lib/utils"
import {
  MEDIA_ACCEPT_ATTR,
  ACCEPTED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  isVideoUrl,
  uploadMedia,
} from "@/lib/media"
import {
  ATTACHMENT_ACCEPT_ATTR,
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  MAX_ATTACHMENT_COUNT,
  uploadEmailAttachment,
  type EmailAttachment,
} from "@/lib/email-attachments"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { ContactPanel } from "./contact-panel"
import { AiNote } from "./ai-note"
import { explainTwilioError } from "@/lib/twilio-errors"
import type { Tables } from "@/lib/database.types"

type Contact = Tables<"contacts">
type Message = Tables<"messages">

interface ThreadPaneProps {
  contact: Contact
  initialMessages: Message[]
  currentUserId: string
  senderNames: Record<string, string>
  /** Server-computed: the conversational (implied-consent) reply window has
   *  lapsed and the contact has no express consent, so sending is blocked
   *  until they message in again. */
  impliedExpired: boolean
  /** Passed through to the mobile contact sheet (which reuses ContactPanel). */
  voiceConfigured: boolean
  optInMode: "send" | "requested" | "blocked" | null
  optInRequestedAt: string | null
  /** Server-computed: whether Claude reply-assist is configured. Passed in (not
   *  client-probed) so the AI button is correct on first paint — no late pop-in
   *  or layout shift. */
  aiEnabled: boolean
}

/** Optimistic message rows are real Message shape but with a temp id and
 *  status='pending'; once the server returns the real row id, we swap. */
type OptimisticMessage = Message & { _optimistic?: boolean }

type Channel = "sms" | "email"

/** Prefill the email subject with "Re: <last subject>" so a reply threads
 *  naturally; collapses any existing "Re:" prefixes and returns "" when the
 *  thread has no prior email to reply to. */
// Static "store" for the platform send-shortcut: the value never changes after
// load, so subscribe is a no-op — useSyncExternalStore is just the
// hydration-safe way to read a client-only value without a hydration mismatch.
const subscribeNever = () => () => {}
const getSendShortcutServer = () => "⌘↵"
function getSendShortcutClient(): string {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ""
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘↵" : "Ctrl+↵"
}

function deriveReplySubject(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.channel === "email" && m.subject) {
      const base = m.subject.replace(/^(re:\s*)+/i, "").trim()
      return base ? `Re: ${base}` : ""
    }
  }
  return ""
}

export function ThreadPane({
  contact: contactProp,
  initialMessages,
  currentUserId,
  senderNames,
  impliedExpired,
  voiceConfigured,
  optInMode,
  optInRequestedAt,
  aiEnabled,
}: ThreadPaneProps) {
  // Contact is held in state so realtime row updates (e.g. a STOP reply
  // flipping sms_opted_out_at) reflect in the thread immediately, without
  // re-navigating. Seeded from the server prop, resynced on thread switch.
  const [contact, setContact] = useState<Contact>(contactProp)
  const [messages, setMessages] = useState<OptimisticMessage[]>(initialMessages)
  const [body, setBody] = useState("")
  const [subject, setSubject] = useState(() => deriveReplySubject(initialMessages))
  // Active compose channel. Default to SMS when a phone is on file (the primary
  // channel), otherwise fall back to email so an email-only contact composes an
  // email straight away.
  const [channel, setChannel] = useState<Channel>(() =>
    contactProp.phone ? "sms" : contactProp.email ? "email" : "sms",
  )
  const [sending, setSending] = useState(false)
  const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(null)
  const [uploading, setUploading] = useState(false)
  // Claude reply-assist: `aiEnabled` (whether it's configured) is a server prop
  // so the button is correct on first paint; `drafting` drives its loading state.
  const [drafting, setDrafting] = useState(false)
  // Operator-only aside from a draft (e.g. "couldn't find that in the knowledge
  // base"). It is NEVER put in the compose box — it surfaces as a small note that
  // animates in above the composer and fades away on its own.
  const [aiNote, setAiNote] = useState<string | null>(null)
  // Email-only composer state: file attachments, AI beautify preview, and the
  // beautify loading flag. The preview holds freshly-sanitized AI HTML; it is
  // the ONLY HTML the operator UI renders (thread bubbles stay plain text).
  const [attachments, setAttachments] = useState<EmailAttachment[]>([])
  const [attachUploading, setAttachUploading] = useState(false)
  const [emailHtml, setEmailHtml] = useState<string | null>(null)
  const [beautifying, setBeautifying] = useState(false)
  // Email preview: a slide-in panel rendering the email exactly as it sends.
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Whether the operator is reading the latest messages (vs. scrolled up into
  // history). A ref, not state, so a late-loading attachment can re-pin without
  // forcing a re-render of the whole thread.
  const pinnedToBottomRef = useRef(true)
  // Mobile-only: the contact panel opens as a slide-over sheet (desktop docks it).
  const [infoOpen, setInfoOpen] = useState(false)

  // Mobile back: animate the thread overlay out (InboxFrame keeps the content
  // mounted through the slide), then fall back to a plain nav if we're somehow
  // rendered outside the inbox frame.
  const router = useRouter()
  const inboxNav = useContext(InboxNavContext)
  function handleBack() {
    if (inboxNav) inboxNav.closeThread()
    else router.push("/inbox")
  }

  // Typing lock: while one staff member is composing, others are blocked from
  // sending into the same thread (prevents two people double-texting a
  // contact). Coordinated over realtime presence; the earliest typer holds
  // the floor, which avoids a mutual-lock deadlock if two start at once.
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingAtRef = useRef<number | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lockedBy, setLockedBy] = useState<string | null>(null)
  const myName = senderNames[currentUserId] ?? "a teammate"

  // A fresh inbound (incl. a JOIN reply) reopens the implied-consent window,
  // so we clear the lapsed banner live without waiting for a re-fetch.
  const [sawInbound, setSawInbound] = useState(false)

  const optedOut = Boolean(contact.sms_opted_out_at)
  const noPhone = !contact.phone
  const conversationLapsed = impliedExpired && !optedOut && !noPhone && !sawInbound
  const locked = lockedBy !== null

  // Email channel availability + compliance, mirroring the SMS gates above.
  const smsAvailable = Boolean(contact.phone)
  const emailAvailable = Boolean(contact.email)
  const emailUnsub = Boolean(contact.email_unsubscribed_at)
  // The toggle only appears when a contact can be reached BOTH ways; with a
  // single channel the composer just uses it (and its own gate banners show).
  const channelToggleVisible = smsAvailable && emailAvailable
  // What blocks sending on the *active* channel (drives which banner shows).
  const smsBlocker = optedOut ? "sms_opt_out" : noPhone ? "no_phone" : conversationLapsed ? "lapsed" : null
  const emailBlocker = !emailAvailable ? "no_email" : emailUnsub ? "unsub" : null
  const activeBlocker = channel === "email" ? emailBlocker : smsBlocker

  // SMS and email are separate conversations. The thread shows only the active
  // channel: email mode shows email; sms mode shows everything else (texts, MMS,
  // and web-form messages, which start a text-able conversation).
  const visibleMessages = messages.filter((m) =>
    channel === "email" ? m.channel === "email" : m.channel !== "email",
  )

  // The email subject lives inside the compose box; this standalone field is
  // only used in AI-preview mode (above the formatted-preview card).
  const subjectField = (className?: string) => (
    <Input
      value={subject}
      onChange={(e) => {
        setSubject(e.target.value)
        onComposeInput()
      }}
      onBlur={stopTyping}
      disabled={locked}
      placeholder="Subject"
      aria-label="Email subject"
      className={cn("rounded-2xl text-small disabled:opacity-60", className)}
    />
  )

  // Text / Email channel selector. Rendered inline at the left of the compose
  // row when composing; falls back to a standalone row when a blocker banner or
  // the AI email preview takes the composer's place (so it never disappears).
  const channelToggle = (
    <div
      role="radiogroup"
      aria-label="Reply channel"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-ink-hairline bg-white p-0.5"
    >
      {(["sms", "email"] as const).map((ch) => {
        const active = channel === ch
        const Icon = ch === "sms" ? MessageSquare : Mail
        return (
          <button
            key={ch}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setChannel(ch)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 py-1.5 text-small font-medium transition-colors",
              active
                ? "bg-[color-mix(in_oklab,var(--gold)_16%,transparent)] text-gold-dark"
                : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon size={15} strokeWidth={2.25} />
            {ch === "sms" ? "Text" : "Email"}
          </button>
        )
      })}
    </div>
  )
  // The + and the selector sit in a row above the composer bar when there's an
  // active composer; otherwise the selector falls back to a standalone row
  // (blocker banner / email AI preview) so it never disappears.
  const composerControlsInline =
    channelToggleVisible && !activeBlocker && !(channel === "email" && emailHtml !== null)

  // The send-shortcut hint: ⌘↵ is only true on Apple hardware — Windows/Linux
  // staff get Ctrl+↵. useSyncExternalStore is the hydration-safe client-only
  // read (server snapshot first paint, client snapshot after). Touch devices
  // hide the keyboard hint entirely via the pointer-fine variant.
  const sendShortcut = useSyncExternalStore(
    subscribeNever,
    getSendShortcutClient,
    getSendShortcutServer,
  )

  // Sync local state when the parent feeds a fresh thread (URL `?c=` change).
  const [lastContactId, setLastContactId] = useState(contactProp.id)
  if (lastContactId !== contactProp.id) {
    setLastContactId(contactProp.id)
    setContact(contactProp)
    setMessages(initialMessages)
    setBody("")
    setSubject(deriveReplySubject(initialMessages))
    setChannel(contactProp.phone ? "sms" : contactProp.email ? "email" : "sms")
    setMedia(null)
    setAttachments([])
    setEmailHtml(null)
    setLockedBy(null)
    setSawInbound(false)
  }

  // Realtime: new messages + status updates AND the contact row itself, so a
  // STOP reply (carrier opt-out) blocks the composer live.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    // Realtime is live-only: while the tab is backgrounded (or the socket blips
    // during Twilio's delivery callbacks) the channel drops and missed INSERT/
    // UPDATE events are NOT replayed. So re-fetch the thread on refocus and on
    // reconnect to catch up — otherwise an inbound message or a delivered status
    // only appears after a manual refresh.
    let subscribedOnce = false
    const runReconcile = async () => {
      // Bound the catch-up: a request stalled by a flaky post-resume network
      // must not wedge `inFlight` forever, which would silently stop every
      // future reconcile and leave the thread permanently stale. On timeout the
      // queries abort, inFlight clears (below), and the next trigger retries.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      try {
      const [{ data: msgs }, { data: c }] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("contact_id", contactProp.id)
          .order("created_at", { ascending: false })
          .limit(80)
          .abortSignal(ctrl.signal),
        supabase
          .from("contacts")
          .select("*")
          .eq("id", contactProp.id)
          .abortSignal(ctrl.signal)
          .maybeSingle(),
      ])
      if (msgs) {
        const server = msgs.slice().reverse()
        setMessages((cur) => {
          // A new inbound (id we didn't have) reopens the conversational window,
          // exactly like a live inbound INSERT does.
          if (server.some((s) => s.direction === "in" && !cur.some((m) => m.id === s.id))) {
            queueMicrotask(() => setSawInbound(true))
          }
          // Replace confirmed rows with server truth; keep only still-pending
          // optimistic sends the server hasn't recorded yet.
          const pending = cur.filter(
            (m) =>
              m._optimistic &&
              !server.some(
                (s) =>
                  s.direction === m.direction &&
                  s.channel === m.channel &&
                  s.body === m.body &&
                  (s.media_url ?? null) === (m.media_url ?? null),
              ),
          )
          return [...server, ...pending]
        })
      }
      if (c) setContact((cur) => ({ ...cur, ...c }))
      } finally {
        clearTimeout(timer)
      }
    }
    // Refocus and socket-reconnect can both ask to catch up at nearly the same
    // moment. Coalesce: ride an in-flight reconcile rather than firing a second
    // parallel fetch, and skip one that lands right after the last so a quick
    // blur/focus doesn't hit the DB twice.
    let inFlight: Promise<void> | null = null
    let lastReconciledAt = 0
    const reconcile = (): Promise<void> => {
      if (document.visibilityState !== "visible") return Promise.resolve()
      if (inFlight) return inFlight
      if (Date.now() - lastReconciledAt < 1500) return Promise.resolve()
      inFlight = runReconcile()
        // Best-effort catch-up: a failed or aborted fetch just retries on the
        // next trigger; swallow it so it doesn't surface as an unhandled
        // rejection (and so a rejection still clears inFlight below).
        .catch(() => {})
        .finally(() => {
          inFlight = null
          lastReconciledAt = Date.now()
        })
      return inFlight
    }
    // A quick glance away keeps the socket alive and the live handlers cover it,
    // so only reconcile after a real absence — coming back stays instant.
    let hiddenAt = 0
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt > 2000) {
        hiddenAt = 0
        void reconcile()
      }
    }
    document.addEventListener("visibilitychange", onVisible)

    const channel = supabase
      .channel(`thread:${contactProp.id}`, {
        config: { presence: { key: currentUserId } },
      })
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
            const incoming = payload.new as Message
            // Any inbound reopens the conversational window — drop the lapsed
            // block immediately.
            if (incoming.direction === "in") setSawInbound(true)
            setMessages((cur) => {
              if (cur.some((m) => m.id === incoming.id)) return cur
              // Swap a matching pending optimistic row with the real one
              // (matched on body since temp ids are random).
              const swapIdx = cur.findIndex(
                (m) =>
                  m._optimistic &&
                  m.direction === "out" &&
                  m.channel === incoming.channel &&
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
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{
          user_id: string
          name: string
          typing_at: number | null
        }>()
        // The earliest active typer holds the floor; ties broken by user_id.
        let floor: { user_id: string; name: string; at: number } | null = null
        for (const key of Object.keys(state)) {
          for (const p of state[key]) {
            if (p.typing_at == null) continue
            if (
              !floor ||
              p.typing_at < floor.at ||
              (p.typing_at === floor.at && p.user_id < floor.user_id)
            ) {
              floor = { user_id: p.user_id, name: p.name, at: p.typing_at }
            }
          }
        }
        setLockedBy(floor && floor.user_id !== currentUserId ? floor.name : null)
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ user_id: currentUserId, name: myName, typing_at: null })
          // A re-SUBSCRIBED after a drop means events may have been missed.
          if (subscribedOnce) void reconcile()
          subscribedOnce = true
        }
      })
    channelRef.current = channel
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingAtRef.current = null
      channelRef.current = null
      document.removeEventListener("visibilitychange", onVisible)
      void supabase.removeChannel(channel)
    }
  }, [contactProp.id, currentUserId, myName])

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    pinnedToBottomRef.current = true
  }, [])

  // Keep `pinned` current: at the bottom (within a small slop) we hold the
  // newest message in view as content grows; scrolled up, we leave them be.
  const onScrollerScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    pinnedToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  // An MMS image/video lays out its real height only after it loads — that's
  // the "things shift a moment after I open a thread" jump: the bubble grows
  // and shoves everything, pushing the latest message off the bottom. Re-pin
  // once it settles, but only when they're already at the bottom, so it never
  // yanks them out of history they've scrolled up to read.
  const onMediaLoad = useCallback(() => {
    if (pinnedToBottomRef.current) scrollToBottom()
  }, [scrollToBottom])

  // Jump to the latest message when the thread opens/switches or a message is
  // added. contactProp.id covers a switch where the message count happens to
  // match, which a length-only dep would miss.
  useEffect(() => {
    scrollToBottom()
  }, [messages.length, contactProp.id, scrollToBottom])

  // Ask Claude to draft a fresh reply (empty composer) or improve the current
  // draft. The result lands in the textarea for the operator to edit — never
  // auto-sent.
  async function handleDraft() {
    if (drafting || locked || optedOut || noPhone || conversationLapsed) return
    setDrafting(true)
    try {
      const res = await fetch("/api/ai/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, draft: body }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          json?.error === "no_context"
            ? "Nothing to reply to yet"
            : json?.error === "disabled"
              ? "Reply assist isn’t configured"
              : "Couldn’t draft a reply",
        )
        return
      }
      // Only the message text ever enters the compose box. Any operator-facing
      // aside rides in `note` and surfaces as the temporary banner, never here.
      setBody(json.draft as string)
      if (typeof json?.note === "string" && json.note.trim()) {
        setAiNote(json.note.trim())
      }
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDrafting(false)
    }
  }

  // Ask Claude to draft a fresh email (empty composer) or beautify the current
  // plain-text draft into formatted HTML. The result lands in a preview card
  // the operator reviews before sending — never auto-sent. The returned HTML is
  // already server-sanitized; we render it via dangerouslySetInnerHTML in the
  // preview only.
  async function handleBeautify() {
    if (beautifying || locked || emailBlocker) return
    setBeautifying(true)
    try {
      const res = await fetch("/api/ai/draft-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, draft: body }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          json?.error === "no_context"
            ? "Nothing to reply to yet"
            : json?.error === "disabled"
              ? "AI email assist isn’t configured"
              : "Couldn’t draft an email",
        )
        return
      }
      if (typeof json?.subject === "string" && json.subject.trim() && !subject.trim()) {
        setSubject(json.subject as string)
      }
      // Seed the plain-text body from the draft's text rendering. This is the
      // text/plain part that gets sent, and it's what un-gates the Send button
      // (which requires a non-empty body) for a fresh draft, not just a
      // beautified one where the operator already typed something.
      if (typeof json?.text === "string" && json.text.trim()) {
        setBody(json.text as string)
      }
      setEmailHtml(json.html as string)
      if (typeof json?.note === "string" && json.note.trim()) {
        setAiNote(json.note.trim())
      }
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBeautifying(false)
    }
  }

  // Revert the AI preview back to the editable textarea so the operator can
  // tweak the plain text and re-beautify.
  function editPreviewText() {
    setEmailHtml(null)
  }

  // Render the email exactly as it will send (same server pipeline) and slide it
  // in. Works for both a plain typed reply and a beautified draft.
  async function handlePreview() {
    if (previewing || !body.trim()) {
      if (!body.trim()) toast.message("Write a message to preview")
      return
    }
    setPreviewing(true)
    setPreviewOpen(true)
    setPreviewHtml(null)
    try {
      const res = await fetch("/api/messages/preview-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contact.id, body, html: emailHtml }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || typeof json?.html !== "string") {
        toast.error("Couldn’t build the preview")
        setPreviewOpen(false)
        return
      }
      setPreviewHtml(json.html as string)
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
      setPreviewOpen(false)
    } finally {
      setPreviewing(false)
    }
  }

  function onPickEmailFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file
    if (!file) return
    if (!ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
      toast.error("Unsupported file type. Use a PDF, image, or document.")
      return
    }
    if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
      toast.error("File too large. 25 MB max per file")
      return
    }
    if (attachments.length >= MAX_ATTACHMENT_COUNT) {
      toast.error(`You can attach up to ${MAX_ATTACHMENT_COUNT} files`)
      return
    }
    const currentBytes = attachments.reduce((sum, a) => sum + a.size, 0)
    if (currentBytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast.error("Attachments exceed the 25 MB total limit")
      return
    }
    setAttachUploading(true)
    uploadEmailAttachment(file)
      .then((meta) => setAttachments((cur) => [...cur, meta]))
      .catch((err) =>
        toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => setAttachUploading(false))
  }

  function removeAttachment(path: string) {
    setAttachments((cur) => cur.filter((a) => a.path !== path))
  }

  function trackTyping(at: number | null) {
    typingAtRef.current = at
    void channelRef.current?.track({
      user_id: currentUserId,
      name: myName,
      typing_at: at,
    })
  }

  function onComposeInput() {
    if (typingAtRef.current == null) trackTyping(Date.now())
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => trackTyping(null), 4000)
  }

  function stopTyping() {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = null
    }
    if (typingAtRef.current != null) trackTyping(null)
  }

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
      body_html: null,
      subject: null,
      media_url: mediaUrl,
      channel: mediaUrl ? "mms" : "sms",
      twilio_sid: null,
      provider_message_id: null,
      email_meta: null,
      status: "sending",
      error: null,
      context: "conversational_reply",
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
        toast.error(
          json.error === "opt_out"
            ? "Contact has opted out"
            : json.error === "implied_expired"
              ? "Reply window closed — they need to message you first"
              : `Send failed: ${json.error}`,
        )
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
    if ((!text && !media) || sending || uploading || optedOut || noPhone || locked || conversationLapsed) return
    stopTyping()
    const sentMedia = media
    setBody("")
    setMedia(null)
    await dispatchSend(text, sentMedia?.url ?? null, sentMedia?.isVideo ?? false, true)
  }

  async function handleRetry(msg: OptimisticMessage) {
    if (sending || locked) return
    if (msg.channel === "email") {
      if (emailBlocker || !msg.subject?.trim() || !msg.body?.trim()) return
      // Retry resends the plain-text part only: the branded HTML can be
      // re-beautified and attachments re-attached from the composer if needed.
      await dispatchEmail(msg.subject, msg.body, null, [], false)
      return
    }
    if (optedOut || noPhone || conversationLapsed) return
    await dispatchSend(msg.body ?? "", msg.media_url, isVideoUrl(msg.media_url ?? ""), false)
  }

  // Email send core. Separate from dispatchSend: a different endpoint, a
  // subject, and no media/segments. Optimistic insert + realtime swap mirror
  // the SMS path. `restoreComposerOnFail` hands the draft back on a fresh send;
  // a retry of an already-failed bubble has no draft to restore.
  async function dispatchEmail(
    subj: string,
    text: string,
    html: string | null,
    files: EmailAttachment[],
    restoreComposerOnFail: boolean,
  ) {
    setSending(true)
    const tempId = `tmp_${crypto.randomUUID()}`
    const optimistic: OptimisticMessage = {
      id: tempId,
      contact_id: contact.id,
      direction: "out",
      body: text,
      body_html: null,
      subject: subj,
      media_url: null,
      channel: "email",
      twilio_sid: null,
      provider_message_id: null,
      email_meta:
        files.length > 0
          ? { attachments: files.map((a) => ({ filename: a.filename, type: a.type, size: a.size })) }
          : null,
      status: "sending",
      error: null,
      context: "conversational_reply",
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
      const res = await fetch("/api/messages/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contact.id,
          subject: subj,
          body: text,
          html,
          attachments: files,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setMessages((cur) => cur.filter((m) => m.id !== tempId))
        if (restoreComposerOnFail) {
          setBody(text)
          setEmailHtml(html)
          setAttachments(files)
        }
        toast.error(
          json.error === "unsubscribed"
            ? "Contact has unsubscribed from email"
            : json.error === "no_channel"
              ? "No email address on file"
              : `Send failed: ${json.error}`,
        )
      } else if (json.mock) {
        setMessages((cur) =>
          cur.map((m) => (m.id === tempId ? { ...m, status: "mocked" } : m)),
        )
        toast.message("Recorded without sending. Brevo isn’t configured yet")
      }
    } catch (err) {
      setMessages((cur) => cur.filter((m) => m.id !== tempId))
      if (restoreComposerOnFail) {
        setBody(text)
        setEmailHtml(html)
        setAttachments(files)
      }
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }

  async function handleSendEmail(e: React.FormEvent) {
    e.preventDefault()
    const subj = subject.trim()
    // When an AI preview is active the body holds the plain text we derived it
    // from; we still send that as the text/plain part and the previewed HTML as
    // the rich part. The plain-text body is required either way.
    const text = body.trim()
    if (!subj || !text || sending || locked || emailBlocker || attachUploading || beautifying) return
    stopTyping()
    const sentHtml = emailHtml
    const sentFiles = attachments
    setBody("")
    setEmailHtml(null)
    setAttachments([])
    await dispatchEmail(subj, text, sentHtml, sentFiles, true)
  }

  // The attach/AI "+" menus, extracted so they can sit either inline with the
  // bar (single channel) or in the controls row above it (when the Text/Email
  // selector is shown).
  const emailPlusMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={attachUploading || beautifying || locked}
          aria-label="Add to email"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-ink-hairline bg-white text-ink-muted transition-colors hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {attachUploading || beautifying ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Plus size={20} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={0} className="bottom-full top-auto mb-2 min-w-[200px]">
        <DropdownMenuItem onClick={() => attachInputRef.current?.click()}>
          <Paperclip size={16} /> Attach files
        </DropdownMenuItem>
        {aiEnabled && (
          <DropdownMenuItem onClick={handleBeautify} disabled={beautifying}>
            <Sparkles size={16} /> {body.trim() ? "Improve with AI" : "Draft with AI"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handlePreview} disabled={!body.trim() || previewing}>
          <Eye size={16} /> Preview email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const smsPlusMenu = aiEnabled ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={uploading || drafting || locked}
          aria-label="Add to message"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-ink-hairline bg-white text-ink-muted transition-colors hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading || drafting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Plus size={20} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={0} className="bottom-full top-auto mb-2 min-w-[200px]">
        <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
          <ImageIcon size={16} /> Photo or video
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDraft} disabled={drafting}>
          <Sparkles size={16} /> {body.trim() ? "Improve with AI" : "Draft with AI"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={uploading || locked}
      aria-label="Attach photo or video"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-ink-hairline bg-white text-ink-muted transition-colors hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
    </button>
  )

  // In the "controls above the bar" layout the + menu is split into separate
  // icon buttons so each action is one tap (no dropdown). Single-channel keeps
  // the + menu inline (above).
  const composerIconButton = (opts: {
    onClick: () => void
    disabled: boolean
    label: string
    loading: boolean
    icon: React.ReactNode
  }) => (
    <button
      type="button"
      onClick={opts.onClick}
      disabled={opts.disabled}
      aria-label={opts.label}
      title={opts.label}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-ink-hairline bg-white text-ink-muted transition-colors hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {opts.loading ? <Loader2 size={18} className="animate-spin" /> : opts.icon}
    </button>
  )
  const smsActionButtons = (
    <div className="flex items-center gap-2">
      {composerIconButton({
        onClick: () => fileInputRef.current?.click(),
        disabled: uploading || locked,
        label: "Photo or video",
        loading: uploading,
        icon: <ImageIcon size={20} />,
      })}
      {aiEnabled &&
        composerIconButton({
          onClick: handleDraft,
          disabled: drafting || locked,
          label: body.trim() ? "Improve with AI" : "Draft with AI",
          loading: drafting,
          icon: <Sparkles size={20} />,
        })}
    </div>
  )
  const emailActionButtons = (
    <div className="flex items-center gap-2">
      {composerIconButton({
        onClick: () => attachInputRef.current?.click(),
        disabled: attachUploading || beautifying || locked,
        label: "Attach files",
        loading: attachUploading,
        icon: <Paperclip size={20} />,
      })}
      {aiEnabled &&
        composerIconButton({
          onClick: handleBeautify,
          disabled: beautifying || locked,
          label: body.trim() ? "Improve with AI" : "Draft with AI",
          loading: beautifying,
          icon: <Sparkles size={20} />,
        })}
      {composerIconButton({
        onClick: handlePreview,
        disabled: !body.trim() || previewing || locked,
        label: "Preview email",
        loading: previewing,
        icon: <Eye size={20} />,
      })}
    </div>
  )

  return (
    <>
      <header className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 py-3 border-b border-ink-hairline bg-bg/95 backdrop-blur">
        <button
          type="button"
          onClick={handleBack}
          className="md:hidden inline-flex items-center justify-center h-11 w-11 -ml-2 rounded-pill hover:bg-white active:bg-white transition-colors"
          aria-label="Back to inbox"
        >
          <ArrowLeft size={18} />
        </button>
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
        {optedOut && <Badge variant="warning" className="shrink-0">Opted out</Badge>}
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="Contact details"
          className="lg:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-ink-hairline text-ink-muted transition-colors hover:bg-white hover:text-ink"
        >
          <Info size={18} />
        </button>
      </header>

      <div
        ref={scrollerRef}
        onScroll={onScrollerScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 md:px-8 py-6 space-y-4"
      >
        {visibleMessages.length === 0 && (
          <div className="text-center py-16">
            <p className="text-ink-faint text-small">
              {channel === "email"
                ? "No emails in this conversation yet. Start one below."
                : "No texts in this conversation yet. Start one below."}
            </p>
          </div>
        )}

        {visibleMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onRetry={handleRetry}
            onMediaLoad={onMediaLoad}
            senderName={m.direction === "out" && m.sent_by ? senderNames[m.sent_by] ?? null : null}
          />
        ))}
      </div>

      <footer className="relative shrink-0 border-t border-ink-hairline bg-bg/95 backdrop-blur px-4 md:px-6 py-3 md:py-4">
        {aiNote && (
          <AiNote key={aiNote} note={aiNote} onDismiss={() => setAiNote(null)} />
        )}
        {/* Standalone selector for the blocker / AI-preview states; an active
            composer shows it in the controls row above the bar instead. */}
        {channelToggleVisible && !composerControlsInline && (
          <div className="mb-2.5 flex items-center justify-end">{channelToggle}</div>
        )}

        {activeBlocker === "sms_opt_out" ? (
          <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,white)] bg-[color-mix(in_oklab,var(--color-warning)_8%,white)] px-3 py-3 text-small text-ink">
            <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
            <p>
              This contact has opted out of SMS. To message them again, they
              must reply{" "}
              <span className="font-mono font-semibold">START</span> to your number.
            </p>
          </div>
        ) : activeBlocker === "no_phone" ? (
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
        ) : activeBlocker === "lapsed" ? (
          <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,white)] bg-[color-mix(in_oklab,var(--color-warning)_8%,white)] px-3 py-3 text-small text-ink">
            <Clock size={16} className="text-warning shrink-0 mt-0.5" />
            <p>
              The reply window has closed. It’s been a while since this contact
              last messaged, so we can’t text them again until they reply or
              opt in. Ask for opt-in from their{" "}
              <Link
                href={`/contacts/${contact.id}?from=inbox`}
                prefetch
                className="text-gold underline underline-offset-2"
              >
                contact page
              </Link>
              {channelToggleVisible ? ", or switch to email above." : "."}
            </p>
          </div>
        ) : activeBlocker === "no_email" ? (
          <div className="flex items-start gap-2 rounded-md border border-ink-hairline bg-white px-3 py-3 text-small text-ink-muted">
            <AlertTriangle size={16} className="text-ink-faint shrink-0 mt-0.5" />
            <p>
              No email address on file.{" "}
              <Link
                href={`/contacts/${contact.id}/edit?from=inbox`}
                prefetch
                className="text-gold underline underline-offset-2"
              >
                Add one
              </Link>{" "}
              to send email.
            </p>
          </div>
        ) : activeBlocker === "unsub" ? (
          <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,white)] bg-[color-mix(in_oklab,var(--color-warning)_8%,white)] px-3 py-3 text-small text-ink">
            <MailX size={16} className="text-warning shrink-0 mt-0.5" />
            <p>
              This contact has unsubscribed from email. Re-enable email on their{" "}
              <Link
                href={`/contacts/${contact.id}?from=inbox`}
                prefetch
                className="text-gold underline underline-offset-2"
              >
                contact page
              </Link>{" "}
              before sending again.
            </p>
          </div>
        ) : channel === "email" ? (
          <>
            {locked && (
              <div className="mb-2 flex items-center gap-2 text-small text-gold-dark" data-dynamic>
                <span className="h-2 w-2 rounded-pill bg-gold animate-pulse shrink-0" />
                {lockedBy} is typing. Sending is paused to avoid a double message.
              </div>
            )}
            <form onSubmit={handleSendEmail} className="space-y-2">
              <input
                ref={attachInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT_ATTR}
                className="hidden"
                onChange={onPickEmailFile}
              />
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <li
                      key={a.path}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline bg-white px-2.5 py-1 text-micro text-ink-muted max-w-[220px]"
                    >
                      <FileText size={13} className="shrink-0 text-ink-faint" />
                      <span className="truncate">{a.filename}</span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.path)}
                        aria-label={`Remove ${a.filename}`}
                        className="shrink-0 text-ink-faint hover:text-ink"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {emailHtml !== null && subjectField()}
              {emailHtml !== null ? (
                <div className="rounded-3xl border border-gold/40 bg-white">
                  <div className="flex items-center gap-1.5 border-b border-ink-hairline px-4 py-2 text-micro text-gold-dark">
                    <Sparkles size={13} className="shrink-0" />
                    AI formatted preview
                  </div>
                  <div
                    className="email-ai-preview max-h-60 overflow-y-auto px-4 py-3 text-body text-ink"
                    dangerouslySetInnerHTML={{ __html: emailHtml }}
                  />
                  <div className="flex flex-wrap items-center gap-2 border-t border-ink-hairline px-4 py-2.5">
                    <button
                      type="button"
                      onClick={editPreviewText}
                      disabled={locked || sending}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline bg-white px-3 py-1.5 text-small text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                    >
                      <Pencil size={14} /> Edit text
                    </button>
                    {aiEnabled && (
                      <button
                        type="button"
                        onClick={handleBeautify}
                        disabled={beautifying || locked || sending}
                        className="inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline bg-white px-3 py-1.5 text-small text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                      >
                        {beautifying ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Regenerate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePreview}
                      disabled={previewing || locked || sending}
                      className="inline-flex items-center gap-1.5 rounded-pill border border-ink-hairline bg-white px-3 py-1.5 text-small text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                    >
                      {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                    </button>
                    <button
                      type="submit"
                      disabled={!subject.trim() || !body.trim() || locked || sending}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-pill bg-gold px-4 py-1.5 text-small font-medium text-white shadow-sm transition-[color,background-color,opacity] duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} strokeWidth={2.25} />} Send
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {composerControlsInline && (
                    <div className="mb-2 flex items-center justify-between">
                      {emailActionButtons}
                      {channelToggle}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    {!composerControlsInline && emailPlusMenu}
                    {/* Subject, divider, body — send anchored bottom-right inside.
                        Full-width when the + sits above; shares the row otherwise. */}
                    <div
                      className={cn(
                        "relative rounded-3xl border border-ink-hairline bg-white transition-colors focus-within:border-gold",
                        composerControlsInline ? "w-full" : "flex-1 min-w-0",
                      )}
                    >
                    <input
                      value={subject}
                      onChange={(e) => {
                        setSubject(e.target.value)
                        onComposeInput()
                      }}
                      onBlur={stopTyping}
                      disabled={locked}
                      placeholder="Subject"
                      aria-label="Email subject"
                      className="block w-full bg-transparent px-4 pt-2.5 pb-1.5 text-small font-medium text-ink placeholder:font-normal placeholder:text-ink-faint focus-visible:outline-none disabled:opacity-60"
                    />
                    <div className="mx-4 h-px bg-ink-hairline" />
                    <Textarea
                      value={body}
                      onChange={(e) => {
                        setBody(e.target.value)
                        onComposeInput()
                      }}
                      onBlur={stopTyping}
                      disabled={locked}
                      placeholder="Write an email…"
                      rows={2}
                      autoGrow
                      className="block w-full min-h-[56px] max-h-52 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-4 py-2.5 pr-14 focus-visible:outline-none disabled:opacity-60"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void handleSendEmail(e)
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!subject.trim() || !body.trim() || locked || sending || attachUploading}
                      aria-label="Send email"
                      className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-pill bg-gold text-white shadow-sm transition-[color,background-color,opacity] duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
                    </button>
                  </div>
                  </div>
                </>
              )}
              <p className="text-micro text-ink-faint">
                Sends from the church email
                <span className="hidden pointer-fine:inline">
                  {" · "}Press <span className="font-mono">{sendShortcut}</span> to send
                </span>
                {!composerControlsInline && " · Tap + to attach files or use AI"}
              </p>
            </form>
          </>
        ) : (
          <>
            {locked && (
              <div className="mb-2 flex items-center gap-2 text-small text-gold-dark" data-dynamic>
                <span className="h-2 w-2 rounded-pill bg-gold animate-pulse shrink-0" />
                {lockedBy} is typing. Sending is paused to avoid a double message.
              </div>
            )}
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
            <form onSubmit={handleSend} className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={MEDIA_ACCEPT_ATTR}
                className="hidden"
                onChange={onPickFile}
              />
              {composerControlsInline && (
                <div className="flex items-center justify-between">
                  {smsActionButtons}
                  {channelToggle}
                </div>
              )}
              <div className="flex items-end gap-2">
                {!composerControlsInline && smsPlusMenu}
                <div className={cn("relative", composerControlsInline ? "w-full" : "flex-1 min-w-0")}>
                <Textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value)
                    onComposeInput()
                  }}
                  onBlur={stopTyping}
                  disabled={locked}
                  placeholder="Write a reply…"
                  rows={1}
                  autoGrow
                  className="block w-full min-h-[44px] max-h-40 resize-none overflow-y-auto rounded-3xl px-4 py-2.5 pr-14 disabled:opacity-60"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void handleSend(e)
                    }
                  }}
                />
                {/* Send anchored at the bottom-right inside the field, iOS-style. */}
                <button
                  type="submit"
                  disabled={(!body.trim() && !media) || uploading || locked}
                  aria-label="Send"
                  className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-pill bg-gold text-white shadow-sm transition-[color,background-color,opacity] duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
                </div>
              </div>
            </form>
            <p
              className={cn(
                "mt-2 text-micro text-ink-faint",
                // With inline controls the only content is the keyboard hint,
                // which is meaningless on touch — drop the line entirely there
                // instead of leaving a blank spacer row.
                composerControlsInline && "hidden pointer-fine:block",
              )}
            >
              <span className="hidden pointer-fine:inline">
                Press <span className="font-mono">{sendShortcut}</span> to send
              </span>
              {!composerControlsInline && (
                <>
                  <span className="hidden pointer-fine:inline">{" · "}</span>
                  Tap + to attach a photo or short video
                </>
              )}
            </p>
          </>
        )}
      </footer>

      {/* Mobile contact context: the same panel, presented as a slide-over. */}
      <Sheet open={infoOpen} onOpenChange={setInfoOpen} side="right">
        <SheetContent className="p-0 w-[min(92vw,400px)]">
          <SheetTitle className="sr-only">Contact details</SheetTitle>
          <ContactPanel
            contact={contact}
            voiceConfigured={voiceConfigured}
            optInMode={optInMode}
            optInRequestedAt={optInRequestedAt}
          />
        </SheetContent>
      </Sheet>

      {/* Email preview: the message rendered exactly as it sends, slid in from
          the side. The full email document is dropped into a sandboxed iframe
          (no scripts) so its own styles render faithfully and in isolation. */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen} side="right">
        <SheetContent className="p-0 w-[min(96vw,520px)] gap-0">
          <div className="flex items-center gap-2 border-b border-ink-hairline px-4 py-3">
            <Eye size={16} className="shrink-0 text-gold-dark" />
            <SheetTitle className="text-body font-medium">Email preview</SheetTitle>
          </div>
          <div className="flex-1 overflow-hidden bg-[#f4f4f5]">
            {previewHtml ? (
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={previewHtml}
                className="h-full w-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-ink-faint">
                <Loader2 size={22} className="animate-spin" />
              </div>
            )}
          </div>
          <p className="border-t border-ink-hairline px-4 py-2.5 text-micro text-ink-faint">
            This is exactly how {contact.name?.split(" ")[0] ?? "the recipient"} will see it.
          </p>
        </SheetContent>
      </Sheet>
    </>
  )
}

function MessageBubble({
  message,
  onRetry,
  onMediaLoad,
  senderName,
}: {
  message: OptimisticMessage
  onRetry: (message: OptimisticMessage) => void
  /** Fired once the bubble's image/video lays out, so the thread can re-pin. */
  onMediaLoad: () => void
  senderName: string | null
}) {
  const isOut = message.direction === "out"
  const isEmail = message.channel === "email"
  const time = useMemo(() => {
    return formatRelative(new Date(message.created_at), new Date())
  }, [message.created_at])
  const pending = message.status === "sending" || message._optimistic
  const failed =
    isOut && (message.status === "failed" || message.status === "undelivered")
  // SMS failures map to Twilio error codes; email failures carry a Brevo
  // string, so don't run them through the Twilio explainer.
  const failureReason = !failed
    ? null
    : isEmail
      ? { title: "Email failed", detail: message.error ?? "The email could not be sent.", action: null }
      : explainTwilioError(message.error, message.status)

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
              onLoadedMetadata={onMediaLoad}
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
                onLoad={onMediaLoad}
                onError={onMediaLoad}
                className="rounded-md max-h-64 w-auto"
              />
            </a>
          ))}
        {isEmail && message.subject && (
          <p className={cn("font-semibold leading-snug mb-1 break-words", isOut ? "text-white" : "text-ink")}>
            {message.subject}
          </p>
        )}
        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
        <p
          data-dynamic
          className={cn(
            "mt-1 text-micro flex items-center gap-1",
            isOut ? "text-white/85" : "text-ink-muted",
          )}
          title={format(new Date(message.created_at), "PPpp")}
        >
          {isEmail && <Mail size={11} className="shrink-0 opacity-80" aria-label="Email" />}
          {isOut && senderName ? `${senderName} · ` : ""}
          {!isOut && message.channel === "form" ? "Web form · " : ""}
          {pending ? "Sending…" : time}
          {!pending && message.status && message.status !== "received" && (
            <span className="ml-2 capitalize">· {message.status}</span>
          )}
        </p>
      </div>
      {failed && (
        <div className="mt-1 flex flex-col items-end gap-0.5 max-w-[85%] md:max-w-[72%]">
          {failureReason && (
            <p className="text-micro text-danger text-right leading-snug">
              <span className="font-medium">{failureReason.title}.</span> {failureReason.detail}
              {failureReason.action && (
                <span className="block text-ink-muted">{failureReason.action}</span>
              )}
            </p>
          )}
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="inline-flex items-center gap-1 text-micro text-danger font-medium hover:underline active:opacity-70"
          >
            <RotateCcw size={11} /> Tap to retry
          </button>
        </div>
      )}
    </div>
  )
}
