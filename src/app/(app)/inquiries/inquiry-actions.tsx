"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { INQUIRY_STATUS_ORDER, INQUIRY_STATUS_META, type InquiryStatus } from "./status"

const SELECT_CLASS =
  "rounded-md border border-ink-hairline bg-white px-2.5 py-1.5 text-small text-ink min-h-9 disabled:opacity-50"

export function InquiryActions({
  id,
  status,
  contactName,
  canText,
}: {
  id: string
  status: InquiryStatus
  contactName: string | null
  canText: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [composing, setComposing] = useState(false)
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  async function changeStatus(next: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toast.error(`Couldn’t update: ${j?.error ?? res.status}`)
      } else {
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  async function sendReply() {
    if (!body.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/inquiries/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Couldn’t send: ${skipReasonLabel(j?.error) ?? res.status}`)
      } else {
        toast.success(j?.mock ? "Recorded (no SMS provider configured)" : "Reply sent")
        setBody("")
        setComposing(false)
        router.refresh()
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-hairline pt-3">
      <label className="inline-flex items-center gap-1.5">
        <span className="text-label text-ink-faint">Status</span>
        <select
          className={SELECT_CLASS}
          value={status}
          disabled={saving}
          onChange={(e) => changeStatus(e.target.value)}
        >
          {INQUIRY_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUS_META[s].label}
            </option>
          ))}
        </select>
      </label>

      {canText && !composing && (
        <Button variant="ghost" size="sm" onClick={() => setComposing(true)}>
          <Send size={14} /> Reply by text
        </Button>
      )}

      {composing && (
        <div className="w-full mt-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={contactName ? `Reply to ${contactName}…` : "Reply…"}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" onClick={sendReply} disabled={sending || !body.trim()}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "Sending…" : "Send text"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setComposing(false)
                setBody("")
              }}
              disabled={sending}
            >
              Cancel
            </Button>
          </div>
          <p className="mt-1 text-micro text-ink-faint">
            Sent as a transactional reply to their inquiry. STOP is always honored.
          </p>
        </div>
      )}
    </div>
  )
}

function skipReasonLabel(reason?: string): string | undefined {
  if (!reason) return undefined
  const map: Record<string, string> = {
    opt_out: "they’ve opted out (STOP)",
    no_channel: "no phone on file",
    not_found: "inquiry not found",
    no_contact: "no contact linked",
  }
  return map[reason] ?? reason
}
