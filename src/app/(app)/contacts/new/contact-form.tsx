"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import type { Tables } from "@/lib/database.types"

const CONSENT_OPTIONS = [
  { value: "verbal", label: "Verbal — given in person" },
  { value: "written", label: "Written — paper form or text reply" },
  { value: "csv_import", label: "CSV import (legacy contact)" },
  { value: "manual_admin", label: "Manual — admin attests" },
]

interface ContactFormProps {
  initialValues?: Partial<Tables<"contacts">>
  contactId?: string
}

/**
 * Used in both `/contacts/new` and `/contacts/[id]/edit`. When `contactId`
 * is provided, submits a PATCH; otherwise POSTs to create a new contact.
 */
export function ContactForm({ initialValues, contactId }: ContactFormProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isEdit = Boolean(contactId)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    const fd = new FormData(e.currentTarget)
    const tagsRaw = (fd.get("tags") as string | null) ?? ""
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)

    const payload = isEdit
      ? {
          name: fd.get("name") || null,
          phone: fd.get("phone") || null,
          email: fd.get("email") || null,
          language: fd.get("language") || "en",
          notes: fd.get("notes") || null,
          tags,
        }
      : {
          name: fd.get("name") || null,
          phone: fd.get("phone") || null,
          email: fd.get("email") || null,
          source: fd.get("source") || "manual",
          consent_method: fd.get("consent_method"),
          language: fd.get("language") || "en",
          notes: fd.get("notes") || null,
          tags,
        }

    try {
      const res = await fetch(
        isEdit ? `/api/contacts/${contactId}` : "/api/contacts",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        if (json.issues) {
          const map: Record<string, string> = {}
          for (const issue of json.issues) {
            map[issue.path?.[0] ?? "form"] = issue.message
          }
          setErrors(map)
        } else if (json.error === "duplicate_phone") {
          setErrors({ phone: "Another contact already has this phone." })
        } else {
          toast.error(`Failed: ${json.error}`)
        }
      } else {
        toast.success(isEdit ? "Contact updated." : "Contact added.")
        router.push(`/contacts/${isEdit ? contactId : json.id}`)
        router.refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormField label="Full name" htmlFor="name" error={errors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={initialValues?.name ?? ""}
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <FormField label="Phone" htmlFor="phone" error={errors.phone} hint="Any format; normalized to E.164 on save.">
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(208) 555-0100"
            defaultValue={initialValues?.phone ?? ""}
          />
        </FormField>
        <FormField label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={initialValues?.email ?? ""}
          />
        </FormField>
      </div>

      {!isEdit && (
        <FormField
          label="Consent method"
          htmlFor="consent_method"
          error={errors.consent_method}
          hint="How did this person agree to be contacted? Required by 10DLC/TCPA."
        >
          <select
            id="consent_method"
            name="consent_method"
            required
            defaultValue="verbal"
            className="block w-full rounded-md border border-ink-hairline bg-white px-3 py-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-gold min-h-11"
          >
            {CONSENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <FormField label="Language" htmlFor="language">
          <select
            id="language"
            name="language"
            defaultValue={initialValues?.language ?? "en"}
            className="block w-full rounded-md border border-ink-hairline bg-white px-3 py-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-gold min-h-11"
          >
            <option value="en">English</option>
            <option value="ru">Russian</option>
          </select>
        </FormField>
        {!isEdit && (
          <FormField label="Source" htmlFor="source" hint="e.g. Sunday service, event, referral.">
            <Input id="source" name="source" placeholder="manual" />
          </FormField>
        )}
      </div>

      <FormField label="Tags" htmlFor="tags" hint="Comma-separated. Use for audience filters in campaigns.">
        <Input
          id="tags"
          name="tags"
          placeholder="newcomer, volunteer"
          defaultValue={initialValues?.tags?.join(", ") ?? ""}
        />
      </FormField>

      <FormField label="Notes" htmlFor="notes">
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initialValues?.notes ?? ""}
        />
      </FormField>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-hairline">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Save contact"}
        </Button>
      </div>
    </form>
  )
}
