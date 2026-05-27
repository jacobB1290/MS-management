"use client"
import Link from "next/link"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Pencil, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CallButton } from "@/components/call-button"
import { OptInRequest } from "@/components/opt-in-request"
import { TagList } from "@/components/tag-list"
import { InboxSegmentControl } from "./inbox-segment-control"
import { isInboxCategory } from "@/lib/inbox-segments"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { formatPhone } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

/**
 * The inbox contact panel — a reply cockpit, not a record dump. It carries only
 * what changes the next message: who they are, how to reach them, the
 * at-a-glance reachability state, notes, tags, and the opt-in/opt-out actions.
 * Provenance (source, consent date) and destructive actions live on the full
 * contact page. Rendered docked on desktop and inside a slide-over sheet on
 * mobile (see thread-pane), so it must stand alone with no surrounding chrome.
 */
export function ContactPanel({
  contact,
  voiceConfigured,
  optInMode,
  optInRequestedAt,
}: {
  contact: Tables<"contacts">
  voiceConfigured: boolean
  optInMode: "send" | "requested" | "blocked" | null
  optInRequestedAt: string | null
}) {
  // Optimistic local state, kept live by a realtime subscription on this
  // contact row so external changes (e.g. a STOP reply) reflect immediately.
  const [snapshot, setSnapshot] = useState(contact)
  const [lastId, setLastId] = useState(contact.id)
  if (lastId !== contact.id) {
    setLastId(contact.id)
    setSnapshot(contact)
  }

  // Unique topic per panel instance. The desktop docked panel and the mobile
  // contact sheet can both be mounted, and @supabase/ssr's browser client is a
  // singleton — two channels sharing one topic on it collide once the socket
  // connects (only happens in real deployments, not the demo). The postgres
  // filter still scopes the events to this contact.
  const channelKey = useId()
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase.channel(`contact-panel:${contact.id}:${channelKey}`)
    try {
      channel
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "contacts", filter: `id=eq.${contact.id}` },
          (payload) => {
            setSnapshot((cur) => ({ ...cur, ...(payload.new as Tables<"contacts">) }))
          },
        )
        .subscribe()
    } catch {
      /* realtime is best-effort; a subscribe failure must never break the panel */
    }
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [contact.id, channelKey])

  const [toggling, setToggling] = useState(false)
  const [pending, setPending] = useState<{
    channel: "sms" | "email"
    optedOut: boolean
  } | null>(null)
  const optedOutSms = Boolean(snapshot.sms_opted_out_at)
  const unsubEmail = Boolean(snapshot.email_unsubscribed_at)
  const hasBadges =
    snapshot.is_member || optedOutSms || unsubEmail || snapshot.language === "ru"

  async function toggleOptOut(channel: "sms" | "email", optedOut: boolean) {
    // Optimistic flip.
    const nowIso = optedOut ? new Date().toISOString() : null
    const before = snapshot
    setSnapshot((cur) =>
      channel === "sms"
        ? { ...cur, sms_opted_out_at: nowIso }
        : { ...cur, email_unsubscribed_at: nowIso },
    )
    setToggling(true)
    try {
      const res = await fetch(`/api/contacts/${snapshot.id}/opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, opted_out: optedOut }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setSnapshot(before)
        toast.error(`Failed: ${j?.error ?? res.status}`)
      } else {
        toast.success(
          optedOut
            ? `${channel.toUpperCase()} disabled`
            : `${channel.toUpperCase()} re-enabled`,
        )
      }
    } catch (err) {
      setSnapshot(before)
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setToggling(false)
      setPending(null)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <p className="eyebrow">Contact</p>
      <div className="mt-1">
        <Link
          href={`/contacts/${snapshot.id}?from=inbox`}
          prefetch
          className="flex items-center gap-1.5 font-display text-heading text-ink leading-tight hover:underline min-w-0 max-w-full"
        >
          <span className="truncate">
            {snapshot.name ?? formatPhone(snapshot.phone) ?? snapshot.email ?? "Unknown"}
          </span>
          <ChevronRight size={18} className="shrink-0 text-ink-faint" />
        </Link>
      </div>

      {hasBadges && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {snapshot.is_member && <Badge variant="gold">Member</Badge>}
          {optedOutSms && <Badge variant="warning">SMS opted-out</Badge>}
          {unsubEmail && <Badge variant="muted">Email unsubscribed</Badge>}
          {snapshot.language === "ru" && <Badge variant="gold">Russian</Badge>}
        </div>
      )}

      <dl className="mt-6 space-y-4">
        <div>
          <dt className="text-label text-ink-muted">Phone</dt>
          <dd className="mt-0.5 flex items-center justify-between gap-2 text-body text-ink break-words">
            <span>{snapshot.phone ? formatPhone(snapshot.phone) : "—"}</span>
            {voiceConfigured && snapshot.phone && (
              <CallButton
                contactId={snapshot.id}
                phone={snapshot.phone}
                contactName={snapshot.name}
                voiceConfigured={voiceConfigured}
                className="shrink-0"
              />
            )}
          </dd>
        </div>
        <Row label="Email" value={snapshot.email ?? "—"} />
        <Row label="Language" value={snapshot.language === "ru" ? "Russian" : "English"} />
      </dl>

      <div className="mt-6">
        <p className="text-label text-ink-muted mb-2">Conversation</p>
        <InboxSegmentControl
          contactId={snapshot.id}
          category={isInboxCategory(snapshot.inbox_category) ? snapshot.inbox_category : "general"}
          status={snapshot.inbox_status}
        />
      </div>

      <div className="mt-6">
        <p className="text-label text-ink-muted mb-2">Tags</p>
        <TagList tags={snapshot.tags} aiTags={snapshot.ai_tags} />
        <p className="text-micro text-ink-faint mt-2">A sparkle marks a tag the AI added; open the contact to edit.</p>
      </div>

      <NotesBlock
        contactId={snapshot.id}
        value={snapshot.notes ?? ""}
        onSaved={(notes) => setSnapshot((cur) => ({ ...cur, notes }))}
      />

      {optInMode && (
        <div className="mt-8 border-t border-ink-hairline pt-6">
          <p className="text-label text-ink-muted mb-1.5">Recurring updates</p>
          <OptInRequest contactId={snapshot.id} mode={optInMode} requestedAt={optInRequestedAt} className="w-full" />
        </div>
      )}

      <div className="mt-8 border-t border-ink-hairline pt-6 space-y-3">
        <div>
          <p className="text-label text-ink-muted mb-1.5">SMS</p>
          {optedOutSms ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling}
              onClick={() => setPending({ channel: "sms", optedOut: false })}
              className="w-full"
            >
              Re-enable SMS
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling || !snapshot.phone}
              onClick={() => setPending({ channel: "sms", optedOut: true })}
              className="w-full"
            >
              Mark opted-out
            </Button>
          )}
        </div>
        <div>
          <p className="text-label text-ink-muted mb-1.5">Email</p>
          {unsubEmail ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling}
              onClick={() => setPending({ channel: "email", optedOut: false })}
              className="w-full"
            >
              Re-enable email
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling || !snapshot.email}
              onClick={() => setPending({ channel: "email", optedOut: true })}
              className="w-full"
            >
              Mark unsubscribed
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title={
          pending?.optedOut
            ? `Opt out of ${pending.channel.toUpperCase()}?`
            : `Re-enable ${pending?.channel.toUpperCase()}?`
        }
        description={
          pending?.optedOut
            ? `They’ll be excluded from all future ${pending.channel === "sms" ? "messages" : "emails"} until they opt back in.`
            : pending?.channel === "sms"
              ? "Only do this if you opted them out manually, not if they texted STOP. Twilio blocks STOP replies at the carrier, and only the contact texting START can lift it; re-enabling here won’t deliver, and the next send will fail and re-flag them."
              : "Only do this if you unsubscribed them manually. If they used an email unsubscribe link, SendGrid keeps suppressing them, so the next send is dropped and re-flags them; they must be removed from the SendGrid suppression group to truly re-enable."
        }
        confirmLabel={pending?.optedOut ? "Opt out" : "Re-enable"}
        destructive={pending?.optedOut ?? false}
        loading={toggling}
        onConfirm={() => {
          if (pending) void toggleOptOut(pending.channel, pending.optedOut)
        }}
      />
    </div>
  )
}

function NotesBlock({
  contactId,
  value: initial,
  onSaved,
}: {
  contactId: string
  value: string
  onSaved: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)

  // Sync when parent's snapshot.notes changes (e.g., after a successful save).
  const [lastInitial, setLastInitial] = useState(initial)
  if (lastInitial !== initial) {
    setLastInitial(initial)
    if (!editing) setValue(initial)
  }

  async function save() {
    const trimmed = value.trim() || null
    setSaving(true)
    // Optimistic: close the editor + push the new value up immediately.
    onSaved(trimmed ?? "")
    setEditing(false)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Save failed: ${j?.error ?? res.status}`)
        // Roll back.
        onSaved(initial)
        setValue(initial)
        setEditing(true)
      } else {
        toast.success("Note saved")
      }
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-6 border-t border-ink-hairline pt-6">
        <p className="text-label text-ink-muted mb-1.5">Notes</p>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder="Lives near the church; has two kids; spouse Maria…"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(initial)
              setEditing(false)
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            Save note
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-ink-hairline pt-6">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-label text-ink-muted">Notes</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-micro text-ink-muted hover:text-ink inline-flex items-center gap-1"
        >
          <Pencil size={12} />
          {initial ? "Edit" : "Add"}
        </button>
      </div>
      {initial ? (
        <p className="text-small text-ink-muted whitespace-pre-wrap leading-prose">
          {initial}
        </p>
      ) : (
        <p className="text-small text-ink-muted italic">
          Nothing noted yet. Key facts get saved automatically as you chat.
        </p>
      )}
      <p className="text-micro text-ink-faint mt-2">Maintained automatically; edit anytime</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="text-body text-ink mt-0.5 break-words">{value}</dd>
    </div>
  )
}
