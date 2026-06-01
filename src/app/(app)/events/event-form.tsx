"use client"
import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ImagePlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
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

export function EventForm({ mode, initial }: EventFormProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

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

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
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

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
      {/* Editor */}
      <form onSubmit={handleSubmit} className="order-2 space-y-6 lg:order-1">
        <FormField label="Title" htmlFor="title" hint="The event name (also the image’s alt text).">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Easter Park Day"
            required
          />
        </FormField>

        {/* All-day toggle */}
        <div className="flex items-center justify-between rounded-lg border border-ink-hairline bg-white px-4 py-3">
          <div>
            <p className="text-body font-medium text-ink">All-day event</p>
            <p className="text-small text-ink-faint">No specific start/end time.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={allDay}
            onClick={() => setAllDay((v) => !v)}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
              allDay ? "bg-gold" : "bg-ink-fade",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-circle bg-white shadow-sm transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                allDay ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Start date" htmlFor="start-date">
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-dynamic
              required
            />
          </FormField>
          {/* Time inputs collapse smoothly when all-day is on. */}
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              allDay ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
            )}
            aria-hidden={allDay}
          >
            <div className="overflow-hidden">
              <FormField label="Start time" htmlFor="start-time">
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  data-dynamic
                  disabled={allDay}
                />
              </FormField>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="End date" htmlFor="end-date" hint="Optional.">
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              data-dynamic
            />
          </FormField>
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              allDay ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
            )}
            aria-hidden={allDay}
          >
            <div className="overflow-hidden">
              <FormField label="End time" htmlFor="end-time" hint="Optional.">
                <Input
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
        </div>

        <FormField label="Location" htmlFor="location" hint="Optional; shown if you add it to the description.">
          <Input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="3080 Wildwood St, Boise"
          />
        </FormField>

        {/* Flyer */}
        <div>
          <p className="mb-2 text-small font-medium text-ink-muted">Flyer image</p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={onPickFile}
          />
          {imageUrl ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Flyer preview"
                className="h-32 rounded-md border border-ink-hairline object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setImageUrl(null)
                  setImagePath(null)
                }}
                aria-label="Remove flyer"
                className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-pill bg-ink text-white shadow-sm transition-transform duration-[var(--motion-fast)] hover:scale-110 motion-reduce:transition-none"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-3 rounded-lg border border-dashed border-ink-hairline bg-white px-4 py-3 text-small text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ImagePlus size={18} className="text-gold" />
              )}
              {uploading ? "Uploading…" : "Add a flyer (this is the event image on ms.church)"}
            </button>
          )}
          <p className="mt-1.5 text-micro text-ink-faint">
            The flyer is the event on the public site. JPG/PNG/WebP, 5 MB max.
          </p>
        </div>

        <FormField
          label="Description"
          htmlFor="description"
          hint="Context for staff + accessibility. Not shown as text on the card."
        >
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={liftDescriptionLink}
            rows={3}
            placeholder="A free community celebration with games, food, and an egg hunt."
          />
        </FormField>

        {/* CTA */}
        <div className="rounded-lg border border-ink-hairline bg-white p-4">
          <p className="text-small font-medium text-ink">Call-to-action button (optional)</p>
          <p className="mb-3 text-micro text-ink-faint">
            Shows as a button on the flyer. The public site only renders it for a full https link.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Button text" htmlFor="cta-text">
              <Input
                id="cta-text"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                placeholder="Reserve your seat"
                maxLength={40}
              />
            </FormField>
            <FormField
              label="Button link"
              htmlFor="cta-url"
              error={ctaWarn ? "Use a full https:// link or it won’t show on the site." : undefined}
            >
              <Input
                id="cta-url"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://ms.church/form"
                inputMode="url"
              />
            </FormField>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-ink-hairline pt-4">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || uploading}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
          </Button>
        </div>
      </form>

      {/* Live preview */}
      <div className="order-1 lg:order-2">
        <div className="mx-auto max-w-[320px] lg:mx-0 lg:max-w-none lg:sticky lg:top-4">
          <p className="eyebrow mb-3">Preview · ms.church</p>
          <EventPreview
            title={title}
            startsAt={startIso}
            endsAt={endIso}
            allDay={allDay}
            imageUrl={imageUrl}
            ctaText={ctaText}
            ctaUrl={ctaUrl}
          />
          <p className="mt-3 max-w-[320px] text-micro text-ink-faint leading-[var(--leading-prose)]">
            This is how the event appears in the ms.church events carousel once published. Changes
            go live within ~5 minutes of publishing.
          </p>
        </div>
      </div>
    </div>
  )
}
