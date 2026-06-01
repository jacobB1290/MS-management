"use client"
import { useState } from "react"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import { ctaIsLive } from "@/server/google/eventMapping"
import { eventDisplayDate, eventDisplayTime } from "@/lib/event-format"

/**
 * A faithful preview of how an event renders on ms.church: the flyer image is
 * the content, with a date badge, an optional time pill, and the CTA as a
 * button overlaid on the image (the site only shows that button for real
 * http(s) links — we mirror that here so staff see the truth before publishing).
 */
export interface EventPreviewProps {
  title: string
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  imageUrl: string | null
  ctaText: string | null
  ctaUrl: string | null
}

export function EventPreview({
  title,
  startsAt,
  endsAt,
  allDay,
  imageUrl,
  ctaText,
  ctaUrl,
}: EventPreviewProps) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const displayDate = startsAt ? eventDisplayDate(startsAt) : "—"
  const time = startsAt ? eventDisplayTime(startsAt, endsAt, allDay) : null
  const showCta = Boolean(ctaUrl && ctaIsLive(ctaUrl) && ctaText)

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
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={imageUrl}
              src={imageUrl}
              alt={title || "Event flyer"}
              onLoad={() => setImgLoaded(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                imgLoaded ? "opacity-100" : "opacity-0",
              )}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-gold/15 to-gold-dark/15 text-gold">
              <CalendarDays size={40} strokeWidth={1.5} />
              <span className="px-6 text-center text-small font-medium text-ink-muted">
                {title || "Add a flyer image"}
              </span>
            </div>
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
