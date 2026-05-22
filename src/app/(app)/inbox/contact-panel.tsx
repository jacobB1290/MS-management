"use client"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-ink-faint">{label}</dt>
      <dd className="text-body text-ink mt-0.5 break-words">{value}</dd>
    </div>
  )
}
