"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ComposerProps {
  tagOptions: { tag: string; count: number }[]
}

export function CampaignComposer({ tagOptions }: ComposerProps) {
  const router = useRouter()
  const [channel, setChannel] = useState<"sms" | "email">("sms")
  const [name, setName] = useState("")
  const [body, setBody] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [subject, setSubject] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [audienceAll, setAudienceAll] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  function toggleTag(tag: string) {
    setSelectedTags((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    )
    if (audienceAll) setAudienceAll(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const audience = audienceAll ? { all: true } : { tags: selectedTags }
    if (!audienceAll && selectedTags.length === 0) {
      toast.error("Pick at least one tag, or choose 'All contacts'.")
      setSubmitting(false)
      return
    }
    const payload =
      channel === "sms"
        ? {
            channel,
            name,
            body,
            audience_filter: audience,
            scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          }
        : {
            channel,
            name,
            sendgrid_template_id: templateId,
            email_subject: subject,
            audience_filter: audience,
            scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          }
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(`Failed: ${json.error}`)
      } else {
        toast.success("Draft saved.")
        router.push(`/campaigns/${json.id}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField label="Campaign name" htmlFor="name" hint="Internal — recipients don't see this.">
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </FormField>

      <div>
        <p className="text-small font-medium text-ink-muted mb-2">Channel</p>
        <Tabs value={channel} onValueChange={(v) => setChannel(v as "sms" | "email")}>
          <TabsList>
            <TabsTrigger value="sms">SMS</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
          </TabsList>

          <TabsContent value="sms" className="mt-5 space-y-5">
            <FormField
              label="Message"
              htmlFor="body"
              hint="Keep under 160 chars to stay in one SMS segment. Longer is fine but costs more."
            >
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Hi friend — Sunday service is at 10am this week. See you there."
              />
              <p className="mt-1 text-micro text-ink-faint text-right">
                {body.length} / 1600 chars
              </p>
            </FormField>
          </TabsContent>

          <TabsContent value="email" className="mt-5 space-y-5">
            <FormField
              label="SendGrid template ID"
              htmlFor="template"
              hint="Design templates in SendGrid Dynamic Templates. Paste the d-xxx... ID here."
            >
              <Input
                id="template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                placeholder="d-abc123…"
                className="font-mono"
              />
            </FormField>
            <FormField label="Subject" htmlFor="subject">
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required={channel === "email"}
              />
            </FormField>
          </TabsContent>
        </Tabs>
      </div>

      <div className="border-t border-ink-hairline pt-6">
        <p className="text-small font-medium text-ink-muted mb-3">Audience</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => {
              setAudienceAll(true)
              setSelectedTags([])
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small transition-colors",
              audienceAll
                ? "border-gold bg-gold text-white"
                : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
            )}
          >
            All contacts
          </button>
          {tagOptions.map((opt) => (
            <button
              key={opt.tag}
              type="button"
              onClick={() => toggleTag(opt.tag)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small transition-colors",
                selectedTags.includes(opt.tag)
                  ? "border-gold bg-gold text-white"
                  : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
              )}
            >
              {opt.tag}
              <Badge variant={selectedTags.includes(opt.tag) ? "default" : "muted"} className="ml-1">
                {opt.count}
              </Badge>
            </button>
          ))}
          {tagOptions.length === 0 && (
            <p className="text-small text-ink-faint">
              No tags on contacts yet. Tag people on their contact page to enable targeted sends.
            </p>
          )}
        </div>
      </div>

      <FormField label="Schedule (optional)" htmlFor="scheduled" hint="Leave blank to send manually from the campaign detail page.">
        <Input
          id="scheduled"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          data-dynamic
        />
      </FormField>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-ink-hairline">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  )
}
