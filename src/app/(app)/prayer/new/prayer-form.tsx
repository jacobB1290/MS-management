"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { formatPhone } from "@/lib/utils"

export function PrayerForm({
  linkedContact,
}: {
  linkedContact: { id: string; name: string | null; phone: string | null } | null
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [name, setName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) {
      toast.error("Add the prayer request.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/prayer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          requester_name: linkedContact ? null : name.trim() || null,
          contact_id: linkedContact?.id ?? null,
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Couldn’t save: ${j?.error ?? res.status}`)
      } else {
        toast.success("Prayer request logged")
        router.push("/prayer")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {linkedContact ? (
        <div className="rounded-md border border-ink-hairline bg-surface p-4">
          <p className="text-label text-ink-faint">For</p>
          <p className="text-body text-ink font-medium">
            {linkedContact.name ?? "Unnamed contact"}
          </p>
          {linkedContact.phone && (
            <p className="text-small text-ink-faint font-mono">
              {formatPhone(linkedContact.phone)}
            </p>
          )}
        </div>
      ) : (
        <FormField
          label="Name (optional)"
          htmlFor="name"
          hint="Who is this prayer for? Leave blank to keep it anonymous."
        >
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Maria, or the Johnson family"
          />
        </FormField>
      )}

      <FormField label="Prayer request" htmlFor="body">
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="What would they like prayer for?"
          required
        />
      </FormField>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-hairline">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Log request"}
        </Button>
      </div>
    </form>
  )
}
