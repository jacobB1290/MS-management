"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"

type Mode = "send" | "requested" | "blocked"

/**
 * Staff affordance to invite a contact to opt in to recurring/marketing
 * messages. The actual gate lives server-side (context "opt_in_request"); this
 * only surfaces the eligible action and its blocked states. On success the
 * contact gets a JOIN invitation and the request is stamped so it can't be
 * re-sent within the conversational window.
 */
export function OptInRequest({
  contactId,
  mode,
  requestedAt,
}: {
  contactId: string
  mode: Mode
  requestedAt: string | null
}) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/opt-in-request`, {
        method: "POST",
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          j?.error === "implied_expired"
            ? "No recent conversation to ask in"
            : j?.error === "opt_in_already_requested"
              ? "An invitation was already sent recently"
              : `Couldn’t send: ${j?.error ?? res.status}`,
        )
      } else {
        toast.success(j?.mock ? "Recorded (Twilio not configured)" : "Opt-in invitation sent")
        router.refresh()
      }
    } catch {
      toast.error("Couldn’t send the invitation")
    } finally {
      setSending(false)
    }
  }

  if (mode === "requested") {
    return (
      <p className="text-small text-ink-faint mt-0.5">
        Invitation sent
        {requestedAt ? ` ${new Date(requestedAt).toLocaleDateString()}` : ""}. Waiting for a JOIN reply.
      </p>
    )
  }

  if (mode === "blocked") {
    return (
      <p className="text-small text-ink-faint mt-0.5">
        You can invite them once they’ve messaged you recently.
      </p>
    )
  }

  return (
    <Button variant="secondary" size="sm" onClick={send} disabled={sending} className="mt-2">
      <Send size={14} />
      {sending ? "Sending…" : "Send opt-in request"}
    </Button>
  )
}
