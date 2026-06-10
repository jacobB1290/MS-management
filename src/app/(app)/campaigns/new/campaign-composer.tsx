"use client"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, X, Megaphone, Sparkles, Mail, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { EditorSection } from "@/components/ui/editor-section"
import { EditorBar } from "@/components/ui/editor-bar"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  MEDIA_ACCEPT_ATTR,
  ACCEPTED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  uploadMedia,
} from "@/lib/media"
import { flyerRenderSrc } from "@/lib/event-format"
import { smsSegmentInfo } from "@/lib/sms-segments"
import { BrevoTemplateField } from "./brevo-template-field"

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
  /** Live contact totals so the audience choice talks in people, not filters. */
  audienceCounts: { total: number; members: number }
  prefill?: ComposerPrefill
}

/** ISO instant → a value the datetime-local input accepts (browser-local). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PANE_IN = "animate-[settings-pane-in_var(--motion-medium)_var(--ease-out-soft)_backwards]"
const SWAP_IN = "inline-block animate-[settings-pane-in_var(--motion-fast)_var(--ease-out-soft)_backwards]"

function people(n: number, word = "person", plural = "people"): string {
  return `${n} ${n === 1 ? word : plural}`
}

export function CampaignComposer({ tagOptions, audienceCounts, prefill }: ComposerProps) {
  const router = useRouter()
  const [channel, setChannel] = useState<"sms" | "email">(prefill?.channel ?? "sms")
  const [name, setName] = useState(prefill?.name ?? "")
  const [body, setBody] = useState(prefill?.body ?? "")
  const [templateId, setTemplateId] = useState("")
  const [subject, setSubject] = useState(prefill?.subject ?? "")
  const [scheduleLater, setScheduleLater] = useState(false)
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
        if (p.scheduledAt) {
          setScheduleLater(true)
          setScheduledAt(isoToLocalInput(p.scheduledAt))
        }
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
    if (channel === "email" && !templateId.trim()) {
      toast.error("Pick a Brevo template.")
      setSubmitting(false)
      return
    }
    const scheduledIso =
      scheduleLater && scheduledAt ? new Date(scheduledAt).toISOString() : null
    const payload =
      channel === "sms"
        ? {
            channel,
            name,
            body,
            media_url: media?.url ?? null,
            audience_filter: audience,
            scheduled_at: scheduledIso,
            event_id: eventId ?? null,
          }
        : {
            channel,
            name,
            brevo_template_id: Number(templateId),
            email_subject: subject,
            audience_filter: audience,
            scheduled_at: scheduledIso,
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

  // Who this reaches, in people. Tag counts can overlap, so that mode says "about".
  const tagSum = Math.min(
    selectedTags.reduce(
      (sum, tag) => sum + (tagOptions.find((o) => o.tag === tag)?.count ?? 0),
      0,
    ),
    audienceCounts.total,
  )
  const reach =
    audienceKind === "all"
      ? audienceCounts.total
      : audienceKind === "members"
        ? audienceCounts.members
        : tagSum
  const reachLabel =
    audienceKind === "tags" ? `about ${people(reach)}` : `up to ${people(reach)}`
  const noTagsPicked = audienceKind === "tags" && selectedTags.length === 0

  const audienceHeadline =
    audienceKind === "all"
      ? "All contacts"
      : audienceKind === "members"
        ? "Members"
        : selectedTags.length > 0
          ? selectedTags.join(" · ")
          : "Pick a tag"

  const banner = aiDrafting
    ? "drafting"
    : aiRationale
      ? "rationale"
      : prefill?.eventTitle
        ? "promo"
        : null

  const preview = (
    <RecipientPreview
      channel={channel}
      body={body}
      media={media}
      subject={subject}
      templateId={templateId}
    />
  )

  return (
    <>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(340px,27vw,420px)] xl:gap-[var(--space-3xl)]">
        <form
          id="campaign-composer"
          onSubmit={handleSubmit}
          className="min-w-0 max-w-[680px] space-y-[var(--space-2xl)]"
        >
          {banner === "promo" && (
            <div
              key="promo"
              className={cn(PANE_IN, "flex items-start gap-2.5 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-3")}
            >
              <Megaphone size={16} className="mt-0.5 shrink-0 text-gold" />
              <p className="text-small text-ink-muted">
                Promoting <span className="font-medium text-ink">{prefill?.eventTitle}</span>. We’ve
                pre-filled the message{prefill?.mediaUrl ? " and attached the flyer" : ""}; opted-out and
                unconsented contacts are still excluded automatically.
              </p>
            </div>
          )}

          {banner === "drafting" && (
            <div
              key="drafting"
              className={cn(PANE_IN, "flex items-center gap-2.5 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-3")}
            >
              <Loader2 size={16} className="shrink-0 animate-spin text-gold" />
              <p className="text-small text-ink-muted">
                Drafting the promotion for{" "}
                <span className="font-medium text-ink">{prefill?.eventTitle}</span> with Opus — reading
                the flyer and choosing the message, audience, and timing…
              </p>
            </div>
          )}

          {banner === "rationale" && (
            <div
              key="rationale"
              className={cn(PANE_IN, "flex items-start gap-2.5 rounded-lg border border-gold/25 bg-gold/[0.07] px-4 py-3")}
            >
              <Sparkles size={16} className="mt-0.5 shrink-0 text-gold" />
              <p className="text-small text-ink-muted">
                <span className="font-medium text-ink">Opus drafted this.</span> {aiRationale} Review and
                adjust anything before you send.
              </p>
            </div>
          )}

          <FormField
            variant="quiet"
            htmlFor="name"
            label={
              <>
                Campaign name
                <span className="font-normal text-ink-faint"> · only staff see this</span>
              </>
            }
            className="max-w-[460px]"
          >
            <Input
              variant="quiet"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Easter invite, week one"
              required
            />
          </FormField>

          <EditorSection step="01" title="Message">
            <ChannelControl value={channel} onChange={setChannel} />

            <div key={channel} className={cn(PANE_IN, "space-y-[var(--space-lg)]")}>
              {channel === "sms" ? (
                <>
                  <div>
                    <FormField variant="quiet" label="Message" htmlFor="body">
                      <Textarea
                        variant="quiet"
                        autoGrow
                        id="body"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={3}
                        maxLength={1600}
                        placeholder="Hi friend, Sunday service is at 10am this week. See you there."
                        className="leading-[var(--leading-prose)]"
                      />
                    </FormField>
                    <SegmentMeter text={body} />
                  </div>

                  <div>
                    <p className="text-micro font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-muted">
                      Attachment<span className="font-normal text-ink-faint"> · optional</span>
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={MEDIA_ACCEPT_ATTR}
                      className="hidden"
                      onChange={onPickFile}
                    />
                    <div className="mt-3">
                      {media ? (
                        <div key="thumb" className={cn(PANE_IN, "relative inline-block")}>
                          {media.isVideo ? (
                            <video
                              src={media.url}
                              className="h-28 rounded-lg border border-ink-hairline"
                              muted
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={flyerRenderSrc(media.url) ?? media.url}
                              alt="Attachment preview"
                              className="h-28 rounded-lg border border-ink-hairline"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => setMedia(null)}
                            aria-label="Remove attachment"
                            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-pill bg-ink text-white shadow-sm transition-transform duration-[var(--motion-fast)] hover:scale-110 motion-reduce:transition-none"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div key="add" className={cn(PANE_IN, "flex items-center gap-3")}>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            aria-label="Attach photo or video"
                            className="btn-icon-action disabled:opacity-50"
                          >
                            {uploading ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <Plus size={20} />
                            )}
                          </button>
                          <span className="text-small text-ink-muted">
                            {uploading ? "Uploading…" : "Attach a photo or video"}
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="mt-2.5 text-micro text-ink-faint">
                      Media sends as MMS. 5 MB max; video must be short.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <FormField
                    variant="quiet"
                    label="Brevo template"
                    htmlFor="template"
                    hint="Pick one of your Brevo templates, or design a new one in Brevo and refresh."
                  >
                    <BrevoTemplateField
                      templateId={templateId}
                      onTemplateId={setTemplateId}
                      onSubject={setSubject}
                    />
                  </FormField>
                  <FormField variant="quiet" label="Subject" htmlFor="subject" className="max-w-[460px]">
                    <Input
                      variant="quiet"
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="You’re invited this Sunday"
                      required={channel === "email"}
                    />
                  </FormField>
                </>
              )}
            </div>

            {/* On mobile the recipient's phone sits right under what you're
                typing — instant feedback. On xl it moves to the rail. */}
            <div className="pt-[var(--space-xs)] xl:hidden">
              <p className="motto mb-3 text-gold">What they’ll see</p>
              {preview}
            </div>
          </EditorSection>

          <EditorSection step="02" title="Audience">
            <div className="flex flex-wrap gap-2">
              <AudienceChip
                label="All contacts"
                count={audienceCounts.total}
                active={audienceKind === "all"}
                onClick={() => {
                  setAudienceKind("all")
                  setSelectedTags([])
                }}
              />
              <AudienceChip
                label="Members"
                count={audienceCounts.members}
                active={audienceKind === "members"}
                onClick={() => {
                  setAudienceKind("members")
                  setSelectedTags([])
                }}
              />
              {tagOptions.map((opt) => (
                <AudienceChip
                  key={opt.tag}
                  label={opt.tag}
                  count={opt.count}
                  active={selectedTags.includes(opt.tag)}
                  onClick={() => toggleTag(opt.tag)}
                />
              ))}
            </div>
            {tagOptions.length === 0 && (
              <p className="text-small text-ink-faint">
                No tags on contacts yet. Tag people on their contact page to enable targeted sends.
              </p>
            )}
            <p className="max-w-prose text-small leading-[var(--leading-prose)] text-ink-muted">
              {noTagsPicked ? (
                "Pick at least one tag, or choose all contacts."
              ) : (
                <>
                  Reaching{" "}
                  <span key={reachLabel} className={cn(SWAP_IN, "font-semibold text-ink")}>
                    {reachLabel}
                  </span>
                  . Opted-out and unconsented contacts come off automatically, and you’ll confirm
                  the exact list before anything sends.
                </>
              )}
            </p>
          </EditorSection>

          <EditorSection step="03" title="Timing">
            <div className="flex max-w-[460px] items-center justify-between gap-[var(--space-md)]">
              <div className="min-w-0">
                <p className="text-small font-medium text-ink">Schedule for later</p>
                <p className="mt-0.5 min-h-[1.1rem] text-micro text-ink-faint">
                  <span key={String(scheduleLater)} className={SWAP_IN}>
                    {scheduleLater
                      ? "Sends itself at the time you pick."
                      : "You’ll send it yourself from the campaign page."}
                  </span>
                </p>
              </div>
              <Switch
                checked={scheduleLater}
                onCheckedChange={(v) => {
                  setScheduleLater(v)
                  if (!v) setScheduledAt("")
                }}
                aria-label="Schedule for later"
              />
            </div>
            <div
              aria-hidden={!scheduleLater}
              className={cn(
                "grid transition-all duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                scheduleLater ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="max-w-[300px] pt-1 pb-0.5">
                  <FormField variant="quiet" label="Send at" htmlFor="scheduled">
                    <Input
                      variant="quiet"
                      id="scheduled"
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      disabled={!scheduleLater}
                      data-dynamic
                    />
                  </FormField>
                </div>
              </div>
            </div>
          </EditorSection>
        </form>

        {/* The recipient's phone, pinned alongside the editor. */}
        <aside className="hidden xl:block">
          <div className="sticky top-4">
            <p className="motto mb-4 text-gold">What they’ll see</p>
            {preview}
            <div className="mt-[var(--space-lg)] w-full max-w-[340px] border-t border-ink-hairline pt-[var(--space-md)]">
              <p className="eyebrow">Audience</p>
              <p className="mt-1.5 font-display text-heading font-medium leading-[var(--leading-snug)] text-ink">
                <span key={audienceHeadline} className={SWAP_IN}>
                  {audienceHeadline}
                </span>
              </p>
              <p className="mt-1 text-small leading-[var(--leading-prose)] text-ink-muted">
                {noTagsPicked ? (
                  "No one selected yet."
                ) : (
                  <>
                    <span key={reachLabel} className={SWAP_IN}>
                      {reachLabel[0].toUpperCase() + reachLabel.slice(1)}
                    </span>
                    , with opt-outs excluded automatically.
                  </>
                )}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <EditorBar
        formId="campaign-composer"
        submitLabel="Save draft"
        busy={submitting || uploading}
        busyLabel={uploading ? "Uploading…" : "Saving…"}
        whisper="Saves as a draft. Nothing sends until you confirm it."
        onCancel={() => router.back()}
      />
    </>
  )
}

/** Channel as a real decision: a segmented pill with a gliding gold thumb. */
function ChannelControl({
  value,
  onChange,
}: {
  value: "sms" | "email"
  onChange: (v: "sms" | "email") => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Channel"
      className="relative grid w-full max-w-[360px] grid-cols-2 rounded-pill border border-ink-hairline bg-surface-elevated p-1 shadow-[var(--shadow-xs)]"
    >
      <span
        aria-hidden
        className={cn(
          "absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-pill",
          "bg-[image:var(--btn-cta-bg)] shadow-[var(--btn-cta-shadow)]",
          "transition-transform duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
          value === "email" ? "translate-x-full" : "translate-x-0",
        )}
      />
      {(
        [
          { value: "sms", label: "Text", icon: <MessageSquare size={15} /> },
          { value: "email", label: "Email", icon: <Mail size={15} /> },
        ] as const
      ).map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "relative z-[1] inline-flex min-h-11 items-center justify-center gap-2 rounded-pill px-4",
            "text-small font-semibold uppercase tracking-[var(--tracking-wide)]",
            "transition-colors duration-[var(--motion-medium)] ease-[var(--ease-standard)] motion-reduce:transition-none",
            value === opt.value ? "text-white" : "text-ink-muted hover:text-ink",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** The writing line's conscience: live characters, billable texts, and the
 *  quiet warning when emoji shrink the capacity. */
function SegmentMeter({ text }: { text: string }) {
  const info = smsSegmentInfo(text)
  const pct = info.capacity ? Math.min(100, Math.round((info.used / info.capacity) * 100)) : 0
  const multi = info.segments > 1
  return (
    <div className="mt-2">
      <div className="h-[2px] overflow-hidden rounded-pill bg-ink-hairline">
        <div
          className={cn(
            "h-full rounded-pill transition-[width,background-color] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
            multi ? "bg-warning" : "bg-gold",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-micro text-ink-faint">
        <span className="tabular-nums">{info.chars} characters</span>
        <span
          className={cn(
            "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
            multi && "font-medium text-warning",
          )}
        >
          {info.segments <= 1 ? "fits in one text" : `sends as ${info.segments} texts`}
        </span>
      </div>
      {info.unicode && (
        <p className={cn(SWAP_IN, "mt-1 text-micro text-ink-faint")}>
          Emoji and special characters shrink each text to 70 characters.
        </p>
      )}
    </div>
  )
}

function AudienceChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-small",
        "transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
        active
          ? "border-gold bg-gold text-white shadow-[var(--shadow-xs)]"
          : "border-ink-hairline bg-white text-ink-muted hover:bg-surface",
      )}
    >
      {label}
      <span
        className={cn(
          "text-micro tabular-nums transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none",
          active ? "text-white/75" : "text-ink-faint",
        )}
      >
        {count}
      </span>
    </button>
  )
}

/** The recipient's phone: their thread with the church for SMS, their inbox
 *  row for email — typed live as the operator writes. */
function RecipientPreview({
  channel,
  body,
  media,
  subject,
  templateId,
}: {
  channel: "sms" | "email"
  body: string
  media: { url: string; isVideo: boolean } | null
  subject: string
  templateId: string
}) {
  return (
    <div className="mx-auto w-full max-w-[340px] xl:mx-0">
      <div className="overflow-hidden rounded-xl border border-ink-hairline bg-white shadow-[var(--shadow-sm)]">
        {/* Contact header — who the message arrives from. */}
        <div className="flex flex-col items-center gap-1.5 border-b border-ink-hairline bg-surface/60 px-4 pb-3 pt-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-pill bg-[image:var(--btn-cta-bg)] font-display text-small font-semibold text-white">
            MS
          </span>
          <span className="text-micro font-medium text-ink">Morning Star</span>
        </div>

        <div key={channel} className={PANE_IN}>
          {channel === "sms" ? (
            <div className="flex min-h-[190px] flex-col gap-2 px-3.5 py-4">
              <p className="text-center text-eyebrow font-medium uppercase tracking-[var(--tracking-wide)] text-ink-fade">
                Text message · Today 9:41 AM
              </p>
              {media && (
                <div className={cn(PANE_IN, "max-w-[78%] self-start")}>
                  {media.isVideo ? (
                    <video
                      src={media.url}
                      muted
                      className="w-full rounded-2xl rounded-bl-md border border-ink-hairline"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={flyerRenderSrc(media.url) ?? media.url}
                      alt=""
                      className="w-full rounded-2xl rounded-bl-md border border-ink-hairline"
                    />
                  )}
                </div>
              )}
              <div className="max-w-[85%] self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-[color-mix(in_oklab,var(--ink)_8%,var(--surface-elevated))] px-3.5 py-2 text-compact leading-[var(--leading-prose)] text-ink">
                {body.trim() || (
                  <span className="italic text-ink-faint">Your message, as they’ll read it.</span>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-[190px] px-4 py-4">
              <p className="text-eyebrow font-medium uppercase tracking-[var(--tracking-wide)] text-ink-fade">
                Inbox
              </p>
              <div className="mt-2.5 border-y border-ink-hairline py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-small font-semibold text-ink">
                    Morning Star Christian Church
                  </span>
                  <span className="shrink-0 text-micro text-ink-faint">9:41 AM</span>
                </div>
                <p className="mt-0.5 truncate text-small font-medium text-ink">
                  {subject.trim() || <span className="italic text-ink-faint">Subject line</span>}
                </p>
                <p className="mt-0.5 text-small leading-[var(--leading-prose)] text-ink-muted">
                  {templateId
                    ? `Designed in Brevo (template #${templateId}).`
                    : "Pick a template to fill this in."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
