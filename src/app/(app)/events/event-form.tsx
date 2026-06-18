"use client"
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { EditorSection } from "@/components/ui/editor-section"
import { EditorBar } from "@/components/ui/editor-bar"
import { PreviewPanel } from "@/components/ui/preview-panel"
import { PreviewStage } from "@/components/ui/preview-stage"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { uploadMedia } from "@/lib/media"
import { ctaIsLive, parseEventDescription, type EventCta } from "@/server/google/eventMapping"
import { EventPreview, EventDetailPreview } from "./event-preview"

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface EventFormInitial {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string | null
  cta_text: string | null
  cta_url: string | null
  secondary_cta_text: string | null
  secondary_cta_url: string | null
  cost: string | null
  ages: string | null
  rsvp_by: string | null
  image_public_url: string | null
  image_storage_path: string | null
}

interface EventFormProps {
  mode: "create" | "edit"
  initial?: EventFormInitial
  /** Lifecycle status (edit mode) — shapes the unsaved-changes whisper. */
  status?: "draft" | "published" | "cancelled"
}

/** Split an ISO instant into browser-local date + time parts for the inputs. */
function splitLocal(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" }
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

export function EventForm({ mode, initial, status }: EventFormProps) {
  const router = useRouter()

  const initStart = splitLocal(initial?.starts_at ?? null)
  const initEnd = splitLocal(initial?.ends_at ?? null)

  // Parse the stored description so legacy rows (whose description column may
  // still hold `[CTA:]`/`[Cost:]`… tags) open with a clean body and the tags
  // lifted into their fields. New rows already store a clean body + columns, so
  // the column value wins (the ?? short-circuits before the parse).
  const parsedInit = initial?.description ? parseEventDescription(initial.description) : null

  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(parsedInit?.description ?? initial?.description ?? "")
  const [location, setLocation] = useState(initial?.location ?? "")
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  const [startDate, setStartDate] = useState(initStart.date)
  const [startTime, setStartTime] = useState(initStart.time || "18:00")
  const [endDate, setEndDate] = useState(initEnd.date)
  const [endTime, setEndTime] = useState(initEnd.time)
  const [ctaText, setCtaText] = useState(initial?.cta_text ?? parsedInit?.ctaText ?? "")
  const [ctaUrl, setCtaUrl] = useState(initial?.cta_url ?? parsedInit?.ctaUrl ?? "")
  const [secondaryCtaText, setSecondaryCtaText] = useState(
    initial?.secondary_cta_text ?? parsedInit?.ctas[1]?.text ?? "",
  )
  const [secondaryCtaUrl, setSecondaryCtaUrl] = useState(
    initial?.secondary_cta_url ?? parsedInit?.ctas[1]?.url ?? "",
  )
  const [cost, setCost] = useState(initial?.cost ?? parsedInit?.cost ?? "")
  const [ages, setAges] = useState(initial?.ages ?? parsedInit?.ages ?? "")
  const [rsvpBy, setRsvpBy] = useState(initial?.rsvp_by ?? parsedInit?.rsvpBy ?? "")
  const [showSecondCta, setShowSecondCta] = useState(
    Boolean((initial?.secondary_cta_url ?? parsedInit?.ctas[1]?.url) ?? ""),
  )
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.image_public_url ?? null)
  const [imagePath, setImagePath] = useState<string | null>(initial?.image_storage_path ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Best-effort ISO for the live preview (null while the date is incomplete).
  const startIso = useMemo(() => {
    if (!startDate) return null
    const local = allDay ? `${startDate}T12:00:00` : `${startDate}T${startTime || "00:00"}`
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }, [allDay, startDate, startTime])

  const endIso = useMemo(() => {
    if (allDay || !endDate || !endTime) return null
    const d = new Date(`${endDate}T${endTime}`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }, [allDay, endDate, endTime])

  function handleFile(file: File) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Use a JPG, PNG, WebP, or GIF image.")
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image too large. 5 MB max.")
      return
    }
    setUploading(true)
    uploadMedia(file)
      .then(({ url, path }) => {
        setImageUrl(url)
        setImagePath(path)
      })
      .catch((err) =>
        toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => setUploading(false))
  }

  // When the operator drops a link into the description (and hasn't set a CTA),
  // lift it into the button on blur — the same parse the public site does, made
  // visible here so they see the link become a button.
  function liftDescriptionLink() {
    if (ctaUrl.trim()) return
    const parsed = parseEventDescription(description)
    if (parsed.ctaUrl) {
      setDescription(parsed.description)
      setCtaText(parsed.ctaText ?? "")
      setCtaUrl(parsed.ctaUrl)
      toast.success("Turned the link in your description into a button.")
    }
  }

  function buildPayload() {
    return {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: startIso,
      ends_at: endIso,
      all_day: allDay,
      location: location.trim() || null,
      cta_text: ctaText.trim() || null,
      cta_url: ctaUrl.trim() || null,
      secondary_cta_text: secondaryCtaText.trim() || null,
      secondary_cta_url: secondaryCtaUrl.trim() || null,
      cost: cost.trim() || null,
      ages: ages.trim() || null,
      rsvp_by: rsvpBy.trim() || null,
      image_storage_path: imagePath,
      image_public_url: imageUrl,
    }
  }

  // Unsaved-changes whisper: compare the would-be payload against the first
  // render's. Cheap (small object), and it can never disagree with what Save
  // actually submits.
  const payloadJson = JSON.stringify(buildPayload())
  const [initialJson] = useState(payloadJson)
  const dirty = payloadJson !== initialJson

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error("Add a title.")
      return
    }
    if (!startIso) {
      toast.error("Pick a date.")
      return
    }
    if (ctaUrl.trim() && !ctaText.trim()) {
      toast.error("Add button text for the link.")
      return
    }
    if (secondaryCtaUrl.trim() && !secondaryCtaText.trim()) {
      toast.error("Add text for the second button.")
      return
    }
    setSaving(true)
    try {
      const isEdit = mode === "edit" && initial
      const res = await fetch(isEdit ? `/api/events/${initial.id}` : "/api/events", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Couldn’t save: ${json?.error ?? res.status}`)
        return
      }
      if (isEdit) {
        toast.success(json?.mock ? "Saved (Google not connected — not pushed live)." : "Saved.")
        router.refresh()
      } else {
        toast.success("Draft saved.")
        router.push(`/events/${json.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const ctaWarn = ctaUrl.trim() !== "" && !ctaIsLive(ctaUrl)
  const secondaryCtaWarn = secondaryCtaUrl.trim() !== "" && !ctaIsLive(secondaryCtaUrl)

  // The live CTAs (only real http(s) links), primary first — exactly what the
  // public site renders. The card shows the first; the detail view shows all.
  const liveCtas: EventCta[] = []
  if (ctaText.trim() && ctaUrl.trim() && ctaIsLive(ctaUrl)) {
    liveCtas.push({ text: ctaText.trim(), url: ctaUrl.trim() })
  }
  if (secondaryCtaText.trim() && secondaryCtaUrl.trim() && ctaIsLive(secondaryCtaUrl)) {
    liveCtas.push({ text: secondaryCtaText.trim(), url: secondaryCtaUrl.trim() })
  }

  // The time fields soften away when "all day" is on — the dates keep the grid,
  // so nothing reflows, the times simply stop being part of the story.
  const timeFade = (hidden: boolean) =>
    cn(
      "transition-[opacity,transform] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
      hidden ? "pointer-events-none -translate-y-1 opacity-0" : "translate-y-0 opacity-100",
    )

  const whisper =
    mode === "create"
      ? "Saves privately as a draft. Publish when you’re ready."
      : dirty
        ? status === "published"
          ? "Unsaved changes. Saving updates ms.church."
          : "Unsaved changes."
        : null

  const flyerCardProps = {
    title,
    startIso,
    endIso,
    allDay,
    imageUrl,
    // The card shows the first live CTA (or "View details" when there's none).
    ctaText: liveCtas[0]?.text ?? "",
    ctaUrl: liveCtas[0]?.url ?? "",
    uploading,
    onFile: handleFile,
    onRemove: () => {
      setImageUrl(null)
      setImagePath(null)
    },
  }

  const detailProps = {
    title,
    startsAt: startIso,
    endsAt: endIso,
    allDay,
    imageUrl,
    location: location.trim() || null,
    cost: cost.trim() || null,
    ages: ages.trim() || null,
    rsvpBy: rsvpBy.trim() || null,
    description: description.trim() || null,
    ctas: liveCtas,
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(330px,26vw,400px)] xl:gap-[var(--space-xl)]">
        {/* The editor reads as a document: the headline first, then the facts
            in numbered steps. Source order = form first, so on mobile the
            fields lead; on xl the live site card watches from its own side
            panel and the form centers in the space that remains. */}
        <form
          id="event-editor"
          onSubmit={handleSubmit}
          className="w-full min-w-0 max-w-[680px] space-y-[var(--space-2xl)] xl:mx-auto"
        >
          {/* The headline IS its own label — the big serif well at the top of
              a document editor needs no small-caps crumb above it. */}
          <FormField variant="quiet" label={<span className="sr-only">Event title</span>} htmlFor="title">
            <Input
              variant="quiet"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Name your event"
              required
              className={cn(
                "h-auto py-1.5 font-display text-title font-semibold",
                "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                "placeholder:font-normal placeholder:text-ink-fade",
              )}
            />
          </FormField>

          <EditorSection
            step="01"
            title="When & where"
            aside={
              <span className="flex items-center gap-2.5">
                <span className="text-small font-medium text-ink">All day</span>
                <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All-day event" />
              </span>
            }
          >
            <div className="grid max-w-[460px] grid-cols-2 gap-x-[var(--space-lg)] gap-y-[var(--space-lg)]">
              <FormField variant="quiet" label="Start date" htmlFor="start-date">
                <Input
                  variant="quiet"
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-dynamic
                  required
                />
              </FormField>
              <div className={timeFade(allDay)} aria-hidden={allDay}>
                <FormField variant="quiet" label="Start time" htmlFor="start-time">
                  <Input
                    variant="quiet"
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    data-dynamic
                    disabled={allDay}
                  />
                </FormField>
              </div>
              <FormField
                variant="quiet"
                htmlFor="end-date"
                label={
                  <>
                    End date<span className="font-normal text-ink-faint"> · optional</span>
                  </>
                }
              >
                <Input
                  variant="quiet"
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-dynamic
                />
              </FormField>
              <div className={timeFade(allDay)} aria-hidden={allDay}>
                <FormField
                  variant="quiet"
                  htmlFor="end-time"
                  label={
                    <>
                      End time<span className="font-normal text-ink-faint"> · optional</span>
                    </>
                  }
                >
                  <Input
                    variant="quiet"
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    data-dynamic
                    disabled={allDay}
                  />
                </FormField>
              </div>
            </div>

            <FormField
              variant="quiet"
              htmlFor="location"
              label={
                <>
                  Location<span className="font-normal text-ink-faint"> · optional</span>
                </>
              }
              hint="Shown in the event’s detail view on ms.church, with a tap-to-open map link."
            >
              <Input
                variant="quiet"
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="3080 Wildwood St, Boise"
              />
            </FormField>
          </EditorSection>

          {/* One step for the public artifact: the flyer and the button(s) that
              live on it. On mobile the site card sits in the flow — you compose
              the artifact top to bottom; on xl it moves to the rail and this
              step keeps just the button fields. */}
          <EditorSection
            step="02"
            title="Flyer & buttons"
            note="What visitors see on ms.church. A button appears on the card when its link is a full https address; add a second for things like directions."
          >
            <FlyerCard
              {...flyerCardProps}
              className="mx-auto w-full max-w-[320px] xl:hidden"
            />
            <div className="grid max-w-[560px] grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-2">
              <FormField variant="quiet" label="Button text" htmlFor="cta-text">
                <Input
                  variant="quiet"
                  id="cta-text"
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  placeholder="Reserve your seat"
                  maxLength={40}
                />
              </FormField>
              <FormField
                variant="quiet"
                label="Button link"
                htmlFor="cta-url"
                error={ctaWarn ? "Use a full https:// link or it won’t show on the site." : undefined}
              >
                <Input
                  variant="quiet"
                  id="cta-url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://ms.church/form"
                  inputMode="url"
                />
              </FormField>
            </div>

            {/* Optional second button — revealed on demand so the common
                single-button case stays uncluttered. */}
            {!showSecondCta && (
              <button
                type="button"
                onClick={() => setShowSecondCta(true)}
                className="min-h-11 self-start text-small font-medium text-gold-dark underline-offset-4 transition-colors duration-[var(--motion-fast)] hover:text-gold hover:underline motion-reduce:transition-none"
              >
                + Add a second button
              </button>
            )}
            <div
              aria-hidden={!showSecondCta}
              className={cn(
                "grid transition-all duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                showSecondCta ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <div className="grid max-w-[560px] grid-cols-1 gap-[var(--space-lg)] pt-[var(--space-lg)] sm:grid-cols-2">
                  <FormField variant="quiet" label="Second button text" htmlFor="cta2-text">
                    <Input
                      variant="quiet"
                      id="cta2-text"
                      value={secondaryCtaText}
                      onChange={(e) => setSecondaryCtaText(e.target.value)}
                      placeholder="Get directions"
                      maxLength={40}
                      tabIndex={showSecondCta ? undefined : -1}
                    />
                  </FormField>
                  <FormField
                    variant="quiet"
                    label="Second button link"
                    htmlFor="cta2-url"
                    error={
                      secondaryCtaWarn
                        ? "Use a full https:// link or it won’t show on the site."
                        : undefined
                    }
                  >
                    <Input
                      variant="quiet"
                      id="cta2-url"
                      value={secondaryCtaUrl}
                      onChange={(e) => setSecondaryCtaUrl(e.target.value)}
                      placeholder="https://maps.google.com/…"
                      inputMode="url"
                      tabIndex={showSecondCta ? undefined : -1}
                    />
                  </FormField>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSecondaryCtaText("")
                    setSecondaryCtaUrl("")
                    setShowSecondCta(false)
                  }}
                  className="mt-[var(--space-sm)] min-h-11 text-small text-ink-muted underline-offset-4 transition-colors duration-[var(--motion-fast)] hover:text-danger hover:underline motion-reduce:transition-none"
                  tabIndex={showSecondCta ? undefined : -1}
                >
                  Remove second button
                </button>
              </div>
            </div>
          </EditorSection>

          <EditorSection
            step="03"
            title="Details & facts"
            note="The description and these quick facts appear in the event’s detail view when someone taps the flyer on ms.church."
          >
            <FormField variant="quiet" label="Description" htmlFor="description">
              <Textarea
                variant="quiet"
                autoGrow
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={liftDescriptionLink}
                rows={3}
                placeholder={
                  "A free community celebration with games, food, and an egg hunt.\n\nWhat to bring:\n- A blanket\n- Your neighbors"
                }
              />
            </FormField>
            <div className="grid grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-3">
              <FormField
                variant="quiet"
                htmlFor="cost"
                label={
                  <>
                    Cost<span className="font-normal text-ink-faint"> · optional</span>
                  </>
                }
              >
                <Input
                  variant="quiet"
                  id="cost"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Free"
                  maxLength={80}
                />
              </FormField>
              <FormField
                variant="quiet"
                htmlFor="ages"
                label={
                  <>
                    Who it’s for<span className="font-normal text-ink-faint"> · optional</span>
                  </>
                }
              >
                <Input
                  variant="quiet"
                  id="ages"
                  value={ages}
                  onChange={(e) => setAges(e.target.value)}
                  placeholder="All ages"
                  maxLength={80}
                />
              </FormField>
              <FormField
                variant="quiet"
                htmlFor="rsvp-by"
                label={
                  <>
                    RSVP by<span className="font-normal text-ink-faint"> · optional</span>
                  </>
                }
              >
                <Input
                  variant="quiet"
                  id="rsvp-by"
                  value={rsvpBy}
                  onChange={(e) => setRsvpBy(e.target.value)}
                  placeholder="April 1"
                  maxLength={80}
                />
              </FormField>
            </div>
          </EditorSection>

          {/* On mobile the detail preview folds into the flow under the editor,
              so staff see the opened view their facts + description compose. */}
          <div className="xl:hidden">
            <PreviewStage
              variant="bare"
              label="When opened"
              caption="The detail view that opens when someone taps the flyer on ms.church."
            >
              <EventDetailPreview {...detailProps} />
            </PreviewStage>
          </div>
        </form>

        {/* The live site surfaces in their own side panel — windows into
            ms.church beside the editor. The card itself is still the flyer
            drop zone; the detail view shows how the facts + body read. */}
        <PreviewPanel>
          <div className="flex flex-col gap-[var(--space-2xl)]">
            <PreviewStage
              variant="bare"
              label="On ms.church"
              caption="How the event appears in the ms.church events carousel once published. Changes go live within ~5 minutes. JPG, PNG, or WebP up to 5 MB."
            >
              <FlyerCard {...flyerCardProps} className="w-full max-w-[320px]" />
            </PreviewStage>
            <PreviewStage
              variant="bare"
              label="When opened"
              caption="The detail view that opens when someone taps the flyer."
            >
              <EventDetailPreview {...detailProps} />
            </PreviewStage>
          </div>
        </PreviewPanel>
      </div>

      <EditorBar
        formId="event-editor"
        submitLabel={mode === "edit" ? "Save changes" : "Save draft"}
        busy={saving || uploading}
        busyLabel={uploading ? "Uploading…" : "Saving…"}
        whisper={whisper}
        onCancel={() => router.back()}
      />
    </>
  )
}

interface FlyerCardProps {
  title: string
  startIso: string | null
  endIso: string | null
  allDay: boolean
  imageUrl: string | null
  ctaText: string
  ctaUrl: string
  uploading: boolean
  onFile: (file: File) => void
  onRemove: () => void
  className?: string
}

/**
 * The site card as the flyer surface: tap it (or drop an image onto it) to set
 * the flyer, with Replace / Remove settling in underneath once one exists.
 * Owns the drag state and the hidden file input; the EventPreview inside only
 * renders the visual states.
 */
function FlyerCard({
  title,
  startIso,
  endIso,
  allDay,
  imageUrl,
  ctaText,
  ctaUrl,
  uploading,
  onFile,
  onRemove,
  className,
}: FlyerCardProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  // Drag enter/leave fire for every child the cursor crosses; a depth counter
  // keeps the highlight steady until the pointer truly leaves the card.
  const dragDepth = useRef(0)

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (file) onFile(file)
  }

  return (
    <div
      className={className}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        setDragOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={pickFile}
      />
      <EventPreview
        title={title}
        startsAt={startIso}
        endsAt={endIso}
        allDay={allDay}
        imageUrl={imageUrl}
        ctaText={ctaText}
        ctaUrl={ctaUrl}
        onFlyerClick={() => fileRef.current?.click()}
        uploading={uploading}
        dragOver={dragOver}
      />
      {/* Replace / Remove settle in under the card once a flyer exists. */}
      <div
        aria-hidden={!imageUrl}
        className={cn(
          "grid transition-all duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
          imageUrl ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="flex max-w-[320px] items-center justify-center gap-[var(--space-md)] pt-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!imageUrl || uploading}
              className="min-h-11 text-small text-ink-muted underline-offset-4 transition-colors duration-[var(--motion-fast)] hover:text-ink hover:underline motion-reduce:transition-none"
            >
              Replace
            </button>
            <span aria-hidden className="h-3 w-px bg-ink-hairline" />
            <button
              type="button"
              onClick={onRemove}
              disabled={!imageUrl || uploading}
              className="min-h-11 text-small text-ink-muted underline-offset-4 transition-colors duration-[var(--motion-fast)] hover:text-danger hover:underline motion-reduce:transition-none"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
