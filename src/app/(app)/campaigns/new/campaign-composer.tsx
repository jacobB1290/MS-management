"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, X, Megaphone, Sparkles } from "lucide-react"
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
import { flyerRenderSrc } from "@/lib/event-format"
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
  /** When true (arriving from "Promote with AI"), the composer asks Opus to draft
   *  the whole campaign on mount and fills the fields from its plan. */
  ai?: boolean
}

interface ComposerProps {
  tagOptions: { tag: string; count: number }[]
  prefill?: ComposerPrefill
}

/** ISO instant → a value the datetime-local input accepts (browser-local). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  // "Promote with AI": on arrival, ask Opus to plan the whole campaign from the
  // event flyer + audience and fill the fields. The static prefill above is the
  // instant fallback shown while it drafts (and if AI is off).
  const [aiDrafting, setAiDrafting] = useState(Boolean(prefill?.ai && eventId))
  const [aiRationale, setAiRationale] = useState<string | null>(null)
  useEffect(() => {
    if (!prefill?.ai || !eventId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/promote`, { method: "POST" })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !json?.proposal) {
          if (res.status === 503)
            toast.info("AI promotion isn’t configured — pre-filled the basics from the event.")
          else toast.error("Couldn’t draft with AI. Pre-filled the basics from the event.")
          return
        }
        const p = json.proposal as {
          channel: "sms" | "email"
          name: string
          body: string
          subject: string
          audience: { mode: "all" | "members" | "tags"; tags: string[] }
          scheduledAt: string | null
          rationale: string
        }
        setChannel(p.channel)
        if (p.name) setName(p.name)
        if (p.body) setBody(p.body)
        if (p.subject) setSubject(p.subject)
        setAudienceKind(p.audience.mode)
        setSelectedTags(p.audience.mode === "tags" ? p.audience.tags : [])
        if (p.scheduledAt) setScheduledAt(isoToLocalInput(p.scheduledAt))
        setAiRationale(p.rationale || null)
        toast.success("Drafted with Opus — review and adjust before sending.")
      } catch {
        if (!cancelled)
          toast.error("Couldn’t reach the AI. Pre-filled the basics from the event.")
      } finally {
        if (!cancelled) setAiDrafting(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const segments = body.length === 0 ? 0 : Math.ceil(body.length / 160)
  const audienceLabel =
    audienceKind === "all"
      ? "All contacts"
      : audienceKind === "members"
        ? "Members"
        : selectedTags.length
          ? selectedTags.join(", ")
          : "Pick at least one tag"

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_clamp(320px,28vw,400px)] xl:gap-12">
      <form onSubmit={handleSubmit} className="space-y-6">
      {prefill?.eventTitle && !aiDrafting && !aiRationale && (
        <div className="flex items-start gap-2.5 rounded-lg border border-gold/30 bg-gold/5 px-4 py-3">
          <Megaphone size={16} className="mt-0.5 shrink-0 text-gold" />
          <p className="text-small text-ink-muted">
            Promoting <span className="font-medium text-ink">{prefill.eventTitle}</span>. We’ve
            pre-filled the message{prefill.mediaUrl ? " and attached the flyer" : ""}; opted-out and
            unconsented contacts are still excluded automatically.
          </p>
        </div>
      )}

      {aiDrafting && (
        <div className="flex items-center gap-2.5 rounded-lg border border-gold/30 bg-gold/5 px-4 py-3">
          <Loader2 size={16} className="shrink-0 animate-spin text-gold" />
          <p className="text-small text-ink-muted">
            Drafting the promotion for{" "}
            <span className="font-medium text-ink">{prefill?.eventTitle}</span> with Opus — reading
            the flyer and choosing the message, audience, and timing…
          </p>
        </div>
      )}

      {aiRationale && (
        <div className="flex items-start gap-2.5 rounded-lg border border-gold/30 bg-gold/[0.07] px-4 py-3">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-gold" />
          <p className="text-small text-ink-muted">
            <span className="font-medium text-ink">Opus drafted this.</span> {aiRationale} Review and
            adjust anything before you send.
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
                      src={flyerRenderSrc(media.url) ?? media.url}
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

      <aside>
        <div className="space-y-3 xl:sticky xl:top-4">
          <p className="motto text-gold">Preview</p>
          {channel === "sms" ? (
            <div className="rounded-2xl border border-ink-hairline bg-surface/60 p-4">
              <div className="ml-auto max-w-[85%]">
                {media && !media.isVideo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={flyerRenderSrc(media.url) ?? media.url} alt="" className="mb-1 w-full rounded-xl border border-ink-hairline" />
                )}
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gold px-3.5 py-2.5 text-small text-white">
                  {body.trim() || "Your message will appear here."}
                </div>
              </div>
              <p className="mt-2 text-right text-micro text-ink-faint">
                {body.length} chars · {segments} segment{segments === 1 ? "" : "s"}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-ink-hairline bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-small font-semibold text-ink">Morning Star Church</span>
                <span className="text-micro text-ink-faint">now</span>
              </div>
              <p className="mt-0.5 truncate text-small font-medium text-ink">
                {subject.trim() || "Subject line"}
              </p>
              <p className="mt-1 text-small text-ink-muted">
                {templateId ? "Rendered from your SendGrid template." : "Pick a template to preview."}
              </p>
            </div>
          )}
          <div className="rounded-xl border border-ink-hairline bg-white px-4 py-3">
            <p className="text-micro uppercase tracking-wide text-ink-faint">Audience</p>
            <p className="mt-0.5 text-small text-ink">{audienceLabel}</p>
            <p className="mt-1 text-micro text-ink-faint">
              Opted-out and unconsented contacts are excluded automatically.
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}
