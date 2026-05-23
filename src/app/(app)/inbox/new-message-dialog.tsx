"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"

const CONSENT_OPTIONS = [
  { value: "verbal", label: "Verbal — given in person" },
  { value: "written", label: "Written — paper form or text reply" },
  { value: "manual_admin", label: "Manual — staff attests" },
]

/**
 * Compose a message to a phone number that may or may not be a contact yet.
 * Finds-or-creates the contact (recording consent, required by 10DLC/TCPA),
 * sends the first message, and opens the thread — no detour through the full
 * contact form.
 */
export function NewMessageDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [body, setBody] = useState("")
  const [consent, setConsent] = useState("verbal")
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPhone("")
    setName("")
    setBody("")
    setConsent("verbal")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!phone.trim()) return setError("Enter a phone number.")
    if (!body.trim()) return setError("Write a message to send.")
    setError(null)
    setSubmitting(true)
    try {
      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          name: name.trim() || null,
          source: "manual",
          consent_method: consent,
          find_or_create: true,
        }),
      })
      const contactJson = await contactRes.json()
      if (!contactRes.ok || !contactJson.id) {
        setError(
          contactJson.issues?.[0]?.message ??
            (contactJson.error === "duplicate_phone"
              ? "That number already belongs to a contact."
              : "Could not start the message. Check the number and try again."),
        )
        return
      }
      const contactId: string = contactJson.id

      const sendRes = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, body: body.trim() }),
      })
      if (!sendRes.ok) {
        const j = await sendRes.json().catch(() => null)
        // Contact exists now; open the thread so they can see why and recover.
        toast.error(
          j?.error === "opt_out"
            ? "That contact has opted out — message not sent"
            : `Message not sent: ${j?.error ?? sendRes.status}`,
        )
      }
      setOpen(false)
      reset()
      router.push(`/inbox?c=${contactId}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger
        aria-label="New message"
        className="inline-flex items-center justify-center h-11 w-11 rounded-pill bg-white border border-ink-hairline text-ink hover:bg-bg active:bg-bg transition-colors"
      >
        <Pencil size={16} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Text a number that isn’t a contact yet. We’ll save them and open the
            thread.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-[var(--space-md)]">
          <FormField label="Phone" htmlFor="nm-phone" hint="Any format; normalized on save.">
            <Input
              id="nm-phone"
              type="tel"
              autoComplete="tel"
              placeholder="(208) 555-0100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </FormField>

          <FormField label="Name" htmlFor="nm-name" hint="Optional — add it now or later.">
            <Input
              id="nm-name"
              autoComplete="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="Consent method"
            htmlFor="nm-consent"
            hint="How did they agree to be contacted? Required by 10DLC/TCPA."
          >
            <select
              id="nm-consent"
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
              className="block w-full rounded-md border border-ink-hairline bg-white px-3 py-2.5 text-body text-ink min-h-11"
            >
              {CONSENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Message" htmlFor="nm-body">
            <Textarea
              id="nm-body"
              rows={3}
              placeholder="Write your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>

          {error && <p className="text-small text-danger">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending…" : "Send message"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
