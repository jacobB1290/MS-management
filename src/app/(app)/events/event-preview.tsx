"use client"
import { useState } from "react"
import { ImagePlus, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ctaIsLive } from "@/server/google/eventMapping"
import { eventDisplayDate, eventDisplayTime, flyerRenderSrc } from "@/lib/event-format"

/**
 * A faithful preview of how an event renders on ms.church: the flyer image is
 * the content, with a date badge, an optional time pill, and the CTA as a
 * button overlaid on the image (the site only shows that button for real
 * http(s) links — we mirror that here so staff see the truth before publishing).
 *
 * When `onFlyerClick` is provided the card doubles as the flyer surface
 * itself: the image area becomes the picker/drop target, so the operator
 * composes the public artifact directly instead of feeding a separate upload
 * widget. Drag state and uploads are owned by the wrapper (see FlyerCard in
 * event-form); this component only renders their visual states.
 */
export interface EventPreviewProps {
  title: string
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  imageUrl: string | null
  ctaText: string | null
  ctaUrl: string | null
  /** Makes the flyer area an interactive picker (tap to add/replace). */
  onFlyerClick?: () => void
  uploading?: boolean
  /** True while a file is dragged over the card. */
  dragOver?: boolean
}

export function EventPreview({
  title,
  startsAt,
  endsAt,
  allDay,
  imageUrl,
  ctaText,
  ctaUrl,
  onFlyerClick,
  uploading = false,
  dragOver = false,
}: EventPreviewProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const src = flyerRenderSrc(imageUrl)
  const displayDate = startsAt ? eventDisplayDate(startsAt) : "—"
  const time = startsAt ? eventDisplayTime(startsAt, endsAt, allDay) : null
  const showCta = Boolean(ctaUrl && ctaIsLive(ctaUrl) && ctaText)
  const interactive = Boolean(onFlyerClick)
  const hasImage = Boolean(src) && !failed

  const flyerContent = hasImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src as string}
      alt={title || "Event flyer"}
      onLoad={() => setImgLoaded(true)}
      onError={() => setFailed(true)}
      className={cn(
        "h-full w-full object-cover transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        imgLoaded ? "opacity-100" : "opacity-0",
      )}
    />
  ) : interactive ? (
    <span
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
        dragOver
          ? "border-gold bg-gold/15"
          : "border-gold/35 bg-gradient-to-br from-gold/[0.07] to-gold-dark/[0.07] group-hover/flyer:border-gold/60",
      )}
    >
      {uploading ? (
        <Loader2 size={26} className="animate-spin text-gold" />
      ) : (
        <ImagePlus size={26} strokeWidth={1.5} className="text-gold" />
      )}
      <span className="px-6 text-small font-medium text-ink-muted">
        {uploading ? "Uploading…" : dragOver ? "Drop to add it" : "Add the flyer"}
      </span>
      <span
        className={cn(
          "px-6 text-micro text-ink-faint transition-opacity duration-[var(--motion-fast)]",
          (uploading || dragOver) && "opacity-0",
        )}
      >
        Tap, or drop an image
      </span>
    </span>
  ) : (
    <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gold/15 to-gold-dark/15 text-gold">
      <ImagePlus size={32} strokeWidth={1.5} />
      <span className="px-6 text-center text-small font-medium text-ink-muted">
        {title || "Add a flyer image"}
      </span>
    </span>
  )

  return (
    <div className="w-full max-w-[320px]">
      <div className="overflow-hidden rounded-xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] hover:shadow-md">
        {/* Header: date (left) + time pill (right) — matches the site card. */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
          <span className="font-display text-[1.35rem] leading-none text-gold">
            {displayDate}
          </span>
          {time && (
            <span className="rounded-pill bg-surface px-2.5 py-1 text-micro font-semibold uppercase tracking-wide text-ink-muted">
              {time}
            </span>
          )}
        </div>

        {/* Flyer: the event's main content on the public site. */}
        <div className="relative mx-4 mb-4 aspect-[4/5] overflow-hidden rounded-lg bg-surface">
          {interactive ? (
            <button
              type="button"
              onClick={onFlyerClick}
              disabled={uploading}
              aria-label={hasImage ? "Replace the flyer" : "Add a flyer"}
              className="group/flyer absolute inset-0 block h-full w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-gold focus-visible:-outline-offset-2 disabled:cursor-wait"
            >
              {flyerContent}
              {hasImage && (
                <span
                  className={cn(
                    "pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-pill bg-ink/70 px-2.5 py-1 text-micro font-medium text-white backdrop-blur-sm",
                    "opacity-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
                    "group-hover/flyer:opacity-100 group-focus-visible/flyer:opacity-100",
                    dragOver && "opacity-100",
                  )}
                >
                  <ImagePlus size={12} />
                  {dragOver ? "Drop to replace" : "Replace flyer"}
                </span>
              )}
            </button>
          ) : (
            flyerContent
          )}

          {/* Upload veil over an existing image — the new flyer settles in
              underneath as soon as it lands. */}
          {interactive && hasImage && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 grid place-items-center bg-white/55 backdrop-blur-[2px]",
                "transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
                uploading ? "opacity-100" : "opacity-0",
              )}
            >
              <Loader2 size={26} className={cn("text-gold", uploading && "animate-spin")} />
            </span>
          )}

          {/* CTA overlay button — fades in/out exactly when the site would show it. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 transition-[opacity,transform] duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              showCta ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            )}
          >
            <span className="btn-cta btn-cta--secondary !min-h-0 !px-4 !py-2 !text-micro shadow-md backdrop-blur">
              {ctaText || "Learn more"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
