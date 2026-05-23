"use client"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { toast } from "sonner"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { formatPhone } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

export function ContactPanel({ contact }: { contact: Tables<"contacts"> }) {
  const router = useRouter()
  const [toggling, setToggling] = useState(false)
  const optedOutSms = Boolean(contact.sms_opted_out_at)
  const unsubEmail = Boolean(contact.email_unsubscribed_at)

  async function toggleOptOut(channel: "sms" | "email", optedOut: boolean) {
    if (
      !confirm(
        optedOut
          ? `Mark this contact as opted-out for ${channel.toUpperCase()}? They will be excluded from all future ${channel === "sms" ? "messages" : "emails"}.`
          : `Re-enable ${channel.toUpperCase()} for this contact? Make sure they've explicitly asked to receive ${channel === "sms" ? "messages" : "emails"} again — never opt someone back in without consent.`,
      )
    )
      return
    setToggling(true)
    try {
      const res = await fetch(`/api/contacts/${contact.id}/opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, opted_out: optedOut }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Failed: ${j?.error ?? res.status}`)
      } else {
        toast.success(
          optedOut
            ? `${channel.toUpperCase()} disabled.`
            : `${channel.toUpperCase()} re-enabled.`,
        )
        router.refresh()
      }
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <p className="eyebrow">Contact</p>
      <Link
        href={`/contacts/${contact.id}`}
        className="block font-display text-heading text-ink leading-tight mt-1 hover:underline"
      >
        {contact.name ?? formatPhone(contact.phone) ?? contact.email ?? "Unknown"}
      </Link>

      <dl className="mt-6 space-y-4">
        <Row label="Phone" value={contact.phone ? formatPhone(contact.phone) : "—"} />
        <Row label="Email" value={contact.email ?? "—"} />
        <Row label="Language" value={contact.language === "ru" ? "Russian" : "English"} />
        <Row label="Source" value={contact.source ?? "—"} />
        <Row
          label="Consent"
          value={
            contact.consent_method
              ? `${contact.consent_method}${contact.consent_at ? ` · ${format(new Date(contact.consent_at), "PP")}` : ""}`
              : "—"
          }
        />
      </dl>

      {contact.tags && contact.tags.length > 0 && (
        <div className="mt-6">
          <p className="text-label text-ink-faint mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((t: string) => (
              <Badge key={t} variant="muted">{t}</Badge>
            ))}
          </div>
        </div>
      )}

      <NotesBlock contactId={contact.id} initial={contact.notes ?? ""} />

      <div className="mt-8 border-t border-ink-hairline pt-6 space-y-3">
        <div>
          <p className="text-label text-ink-faint mb-1.5">SMS</p>
          {optedOutSms ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling}
              onClick={() => toggleOptOut("sms", false)}
              className="w-full"
            >
              Re-enable SMS
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={toggling || !contact.phone}
              onClick={() => toggleOptOut("sms", true)}
              className="w-full justify-start text-ink-muted hover:text-danger"
            >
              Mark opted-out
            </Button>
          )}
        </div>
        <div>
          <p className="text-label text-ink-faint mb-1.5">Email</p>
          {unsubEmail ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={toggling}
              onClick={() => toggleOptOut("email", false)}
              className="w-full"
            >
              Re-enable email
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={toggling || !contact.email}
              onClick={() => toggleOptOut("email", true)}
              className="w-full justify-start text-ink-muted hover:text-danger"
            >
              Mark unsubscribed
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function NotesBlock({ contactId, initial }: { contactId: string; initial: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value.trim() || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Save failed: ${j?.error ?? res.status}`)
      } else {
        toast.success("Note saved.")
        setEditing(false)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-6 border-t border-ink-hairline pt-6">
        <p className="text-label text-ink-faint mb-1.5">Notes</p>
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
            {saving ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-ink-hairline pt-6">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-label text-ink-faint">Notes</p>
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
        <p className="text-small text-ink-faint italic">
          No notes yet. Drop a quick reminder of what you talked about last.
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-ink-faint">{label}</dt>
      <dd className="text-body text-ink mt-0.5 break-words">{value}</dd>
    </div>
  )
}
