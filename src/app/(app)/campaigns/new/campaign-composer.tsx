"use client"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, X, Megaphone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  MEDIA_ACCEPT_ATTR,
  ACCEPTED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  uploadMedia,
} from "@/lib/media"
import { SendgridTemplateField } from "./sendgrid-template-field"

/** Optional seed values when arriving from an event's "Promote" action. */
export interface ComposerPrefill {
  channel?: "sms" | "email"
  name?: string
  body?: string
  mediaUrl?: string | null
  subject?: string
  eventId?: string
  eventTitle?: string
}

interface ComposerProps {
  tagOptions: { tag: string; count: number }[]
  prefill?: ComposerPrefill
}

export function CampaignComposer({ tagOptions, prefill }: ComposerProps) {
  const router = useRouter()
  const [channel, setChannel] = useState<"sms" | "email">(prefill?.channel ?? "sms")
  const [name, setName] = useState(prefill?.name ?? "")
  const [body, setBody] = useState(prefill?.body ?? "")
  const [templateId, setTemplateId] = useState("")
  const [subject, setSubject] = useState(prefill?.subject ?? "")
  const [scheduledAt, setScheduledAt] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [audienceKind, setAudienceKind] = useState<"all" | "members" | "tags">("all")
  const [submitting, setSubmitting] = useState(false)
  const [media, setMedia] = useState<{ url: string; isVideo: boolean } | null>(
    prefill?.mediaUrl ? { url: prefill.mediaUrl, isVideo: false } : null,
  )
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventId = prefill?.eventId

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
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

  function toggleTag(tag: string) {
    setSelectedTags((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    )
    setAudienceKind("tags")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const audience =
      audienceKind === "all"
        ? { all: true }
        : audienceKind === "members"
          ? { members: true }
          : { tags: selectedTags }
    if (audienceKind === "tags" && selectedTags.length === 0) {
      toast.error("Pick at least one tag, or choose ‘All contacts’.")
      setSubmitting(false)
      return
    }
    if (channel === "sms" && !body.trim() && !media) {
      toast.error("Add a message or an attachment.")
      setSubmitting(false)
      return
    }
    const payload =
      channel === "sms"
        ? {
            channel,
            name,
            body,
            media_url: media?.url ?? null,
            audience_filter: audience,
            scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            event_id: eventId ?? null,
          }
        : {
            channel,
            name,
            sendgrid_template_id: templateId,
            email_subject: subject,
            audience_filter: audience,
            scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            event_id: eventId ?? null,
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
      {prefill?.eventTitle && (
        <div className="flex items-start gap-2.5 rounded-lg border border-gold/30 bg-gold/5 px-4 py-3">
          <Megaphone size={16} className="mt-0.5 shrink-0 text-gold" />
          <p className="text-small text-ink-muted">
            Promoting <span className="font-medium text-ink">{prefill.eventTitle}</span>. We’ve
            pre-filled the message{prefill.mediaUrl ? " and attached the flyer" : ""}; opted-out and
            unconsented contacts are still excluded automatically.
          </p>
        </div>
      )}

      <FormField label="Campaign name" htmlFor="name" hint="Internal; recipients don’t see this.">
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
                placeholder="Hi friend, Sunday service is at 10am this week. See you there."
              />
              <p className="mt-1 text-micro text-ink-faint text-right">
                {body.length} / 1600 chars
              </p>
            </FormField>

            <div>
              <p className="text-small font-medium text-ink-muted mb-2">
                Attachment (optional)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={MEDIA_ACCEPT_ATTR}
                className="hidden"
                onChange={onPickFile}
              />
              {media ? (
                <div className="relative inline-block">
                  {media.isVideo ? (
                    <video
                      src={media.url}
                      className="h-24 rounded-md border border-ink-hairline"
                      muted
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={media.url}
                      alt="Attachment preview"
                      className="h-24 rounded-md border border-ink-hairline"
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
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    aria-label="Attach photo or video"
                    className="btn-icon-action disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
                  </button>
                  <span className="text-small text-ink-muted">
                    {uploading ? "Uploading…" : "Attach photo or video"}
                  </span>
                </div>
              )}
              <p className="mt-1.5 text-micro text-ink-faint">
                Adding media sends as MMS. Max 5 MB; video must be short.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="email" className="mt-5 space-y-5">
            <FormField
              label="SendGrid template ID"
              htmlFor="template"
              hint="Pick one of your SendGrid templates or open the builder to design a new one."
            >
              <SendgridTemplateField
                templateId={templateId}
                onTemplateId={setTemplateId}
                onSubject={setSubject}
                campaignName={name}
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
              setAudienceKind("all")
              setSelectedTags([])
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small transition-colors",
              audienceKind === "all"
                ? "border-gold bg-gold text-white"
                : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
            )}
          >
            All contacts
          </button>
          <button
            type="button"
            onClick={() => {
              setAudienceKind("members")
              setSelectedTags([])
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small transition-colors",
              audienceKind === "members"
                ? "border-gold bg-gold text-white"
                : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
            )}
          >
            Members
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
        <Button type="submit" disabled={submitting || uploading}>
          {submitting ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </form>
  )
}
