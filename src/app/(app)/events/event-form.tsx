"use client"
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { EditorSection } from "@/components/ui/editor-section"
import { EditorBar } from "@/components/ui/editor-bar"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { uploadMedia } from "@/lib/media"
import { ctaIsLive, parseEventDescription } from "@/server/google/eventMapping"
import { EventPreview } from "./event-preview"

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

  // A synced event may keep its button as a link in the description (the
  // ms.church "Label: url" convention) with no structured CTA yet. Lift it so
  // the editor + preview show it as a button from the first paint.
  const lifted =
    !initial?.cta_url && initial?.description ? parseEventDescription(initial.description) : null

  const [title, setTitle] = useState(initial?.title ?? "")
  const [description, setDescription] = useState(
    lifted?.ctaUrl ? lifted.description : (initial?.description ?? ""),
  )
  const [location, setLocation] = useState(initial?.location ?? "")
  const [allDay, setAllDay] = useState(initial?.all_day ?? false)
  const [startDate, setStartDate] = useState(initStart.date)
  const [startTime, setStartTime] = useState(initStart.time || "18:00")
  const [endDate, setEndDate] = useState(initEnd.date)
  const [endTime, setEndTime] = useState(initEnd.time)
  const [ctaText, setCtaText] = useState(initial?.cta_text ?? lifted?.ctaText ?? "")
  const [ctaUrl, setCtaUrl] = useState(initial?.cta_url ?? lifted?.ctaUrl ?? "")
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
    ctaText,
    ctaUrl,
    uploading,
    onFile: handleFile,
    onRemove: () => {
      setImageUrl(null)
      setImagePath(null)
    },
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(330px,26vw,400px)] xl:gap-[var(--space-3xl)]">
        {/* The editor reads as a document: the headline first, then the facts.
            Source order = form first, so on mobile the fields lead; on xl the
            live site card keeps it company from the right rail. */}
        <form
          id="event-editor"
          onSubmit={handleSubmit}
          className="min-w-0 max-w-[680px] space-y-[var(--space-2xl)]"
        >
          <FormField variant="quiet" label="Title" htmlFor="title">
            <Input
              variant="quiet"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Easter Park Day"
              required
              className={cn(
                "h-auto py-1.5 font-display text-title font-semibold",
                "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                "placeholder:font-normal placeholder:text-ink-fade",
              )}
            />
          </FormField>

          <EditorSection title="When & where">
            <div className="flex max-w-[460px] items-center justify-between gap-[var(--space-md)]">
              <span className="text-small font-medium text-ink">All-day event</span>
              <Switch checked={allDay} onCheckedChange={setAllDay} aria-label="All-day event" />
            </div>

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
              hint="Shown on the site only if you mention it in the description."
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

          {/* On mobile the site card itself lives in the flow — you compose the
              public artifact top to bottom. On xl it moves to the rail. */}
          <EditorSection
            title="Flyer"
            className="xl:hidden"
            note="The flyer is the event on the public site; the title doubles as its alt text. JPG, PNG, or WebP up to 5 MB."
          >
            <FlyerCard {...flyerCardProps} className="mx-auto w-full max-w-[320px]" />
          </EditorSection>

          <EditorSection
            title="Details"
            note="Context for staff and accessibility. Not shown as text on the card."
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
                placeholder="A free community celebration with games, food, and an egg hunt."
              />
            </FormField>
          </EditorSection>

          <EditorSection
            title="Button"
            note="Shows as a button on the flyer. The public site renders it only for a full https link."
          >
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
          </EditorSection>
        </form>

        {/* The live site card — a window into ms.church, pinned alongside the
            editor. It is also the flyer surface: tap it or drop an image on it. */}
        <aside className="hidden xl:block">
          <div className="sticky top-4">
            {/* Rail labels speak in the small-caps eyebrow voice, matching the
                campaign composer's rail — italics belong to .motto phrases. */}
            <p className="eyebrow mb-4">On ms.church</p>
            <FlyerCard {...flyerCardProps} className="w-full max-w-[320px]" />
            <p className="mt-4 max-w-[320px] text-micro leading-[var(--leading-prose)] text-ink-faint">
              This is how the event appears in the ms.church events carousel once published.
              Changes go live within ~5 minutes. JPG, PNG, or WebP up to 5 MB.
            </p>
          </div>
        </aside>
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
