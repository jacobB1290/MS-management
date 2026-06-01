"use client"
import { useMemo, useRef, useState, type ReactNode } from "react"
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

/** A flush field group: a Playfair heading + a gold hairline, no card. */
function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="font-display text-lead font-medium leading-none text-ink">{title}</h3>
        <span className="h-px flex-1 bg-gradient-to-r from-gold/40 to-transparent" />
      </div>
      {children}
    </section>
  )
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

  // Smoothly collapses the time inputs when "all-day" is on.
  const timeCollapse = cn(
    "grid transition-all duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
    allDay ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
  )

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_clamp(320px,26vw,400px)] xl:gap-12">
      {/* Editor */}
      <form onSubmit={handleSubmit} className="order-2 space-y-10 xl:order-1">
        <FieldGroup title="Basics">
          <FormField label="Title" htmlFor="title" hint="The event name (also the image’s alt text).">
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Easter Park Day"
              required
            />
          </FormField>
        </FieldGroup>

        <FieldGroup title="When">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-body font-medium text-ink">All-day event</p>
              <p className="text-small text-ink-faint">No specific start or end time.</p>
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
              <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-dynamic required />
            </FormField>
            <div className={timeCollapse} aria-hidden={allDay}>
              <div className="overflow-hidden">
                <FormField label="Start time" htmlFor="start-time">
                  <Input id="start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} data-dynamic disabled={allDay} />
                </FormField>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="End date" htmlFor="end-date" hint="Optional.">
              <Input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-dynamic />
            </FormField>
            <div className={timeCollapse} aria-hidden={allDay}>
              <div className="overflow-hidden">
                <FormField label="End time" htmlFor="end-time" hint="Optional.">
                  <Input id="end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} data-dynamic disabled={allDay} />
                </FormField>
              </div>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Where">
          <FormField label="Location" htmlFor="location" hint="Optional; shown if you add it to the description.">
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="3080 Wildwood St, Boise" />
          </FormField>
        </FieldGroup>

        <FieldGroup title="Flyer">
          <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="hidden" onChange={onPickFile} />
          {imageUrl ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Flyer preview" className="h-40 rounded-lg border border-ink-hairline object-cover" />
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
              className="flex aspect-[4/5] w-full max-w-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gold/40 bg-gradient-to-br from-gold/[0.06] to-gold-dark/[0.06] text-center text-small text-ink-muted transition-colors duration-[var(--motion-fast)] hover:from-gold/12 hover:to-gold-dark/10 disabled:opacity-50 motion-reduce:transition-none"
            >
              {uploading ? <Loader2 size={22} className="animate-spin text-gold" /> : <ImagePlus size={22} className="text-gold" />}
              <span className="px-4">{uploading ? "Uploading…" : "Add a flyer"}</span>
            </button>
          )}
          <p className="text-micro text-ink-faint">
            The flyer is the event on the public site. JPG/PNG/WebP, 5 MB max.
          </p>
        </FieldGroup>

        <FieldGroup title="Details">
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
        </FieldGroup>

        <FieldGroup title="Button">
          <p className="-mt-1 text-small text-ink-faint">
            Shows as a button on the flyer. The public site only renders it for a full https link.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Button text" htmlFor="cta-text">
              <Input id="cta-text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Reserve your seat" maxLength={40} />
            </FormField>
            <FormField
              label="Button link"
              htmlFor="cta-url"
              error={ctaWarn ? "Use a full https:// link or it won’t show on the site." : undefined}
            >
              <Input id="cta-url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://ms.church/form" inputMode="url" />
            </FormField>
          </div>
        </FieldGroup>

        <div className="flex items-center justify-end gap-3 border-t border-ink-hairline pt-5">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || uploading}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
          </Button>
        </div>
      </form>

      {/* Live preview — a window into the public site */}
      <div className="order-1 xl:order-2">
        <div className="mx-auto max-w-[340px] xl:mx-0 xl:max-w-none xl:sticky xl:top-4">
          <p className="motto mb-3 text-gold">On ms.church</p>
          <div className="rounded-2xl border border-gold/20 bg-surface/70 p-4">
            <EventPreview
              title={title}
              startsAt={startIso}
              endsAt={endIso}
              allDay={allDay}
              imageUrl={imageUrl}
              ctaText={ctaText}
              ctaUrl={ctaUrl}
            />
          </div>
          <p className="mt-3 text-micro text-ink-faint leading-[var(--leading-prose)]">
            This is how the event appears in the ms.church events carousel once published. Changes go
            live within ~5 minutes of publishing.
          </p>
        </div>
      </div>
    </div>
  )
}
