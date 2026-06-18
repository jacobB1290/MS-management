"use client"
import { useCallback, useState } from "react"
import { ImagePlus, Loader2, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { ctaIsLive, type EventCta } from "@/server/google/eventMapping"
import {
  eventDisplayDate,
  eventDisplayTime,
  eventMapsLink,
  flyerRenderSrc,
  formatEventBlocks,
} from "@/lib/event-format"

/**
 * A genuinely faithful preview of how an event renders on ms.church. There are
 * two surfaces, matching the public site exactly:
 *
 *  - {@link EventPreview} — the carousel CARD: a frosted outer-card with a plain
 *    gold uppercase date/time header, the 3:4 flyer, and a single gold CTA pill
 *    (the primary live link) or a "View details" pill when there's no link.
 *    Mirrors `.event-outer-card` / `.event-date` / `.event-link-btn` in the
 *    site's home-styles.ts. When `onFlyerClick` is provided the flyer doubles as
 *    the upload target so the operator composes the public artifact directly.
 *
 *  - {@link EventDetailPreview} — the DETAIL lightbox interior the flyer opens on
 *    the site: large flyer, when/where facts, the formatted description body,
 *    and every CTA. Mirrors `.event-detail-*` in the site. This is where the
 *    description, location, and structured facts actually surface publicly, so
 *    the editor shows it live as staff type.
 *
 * Both are kept in lockstep with the site by `scripts/events/verify-mapping.ts`
 * (the contract) and by matching the site's token values 1:1.
 */

const HEADER_TEXT =
  "text-body font-bold uppercase leading-none tracking-[1.5px] text-gold whitespace-nowrap"

export interface EventPreviewProps {
  title: string
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  imageUrl: string | null
  /** The primary live CTA shown on the card (text + url). */
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
  // If the image is already decoded when it mounts (a cached or data-URL flyer),
  // show it at full opacity immediately instead of waiting on a load event that
  // already fired — so it never sits invisibly behind the fade gate.
  const imgRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setImgLoaded(true)
  }, [])
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
      ref={imgRef}
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
      {/* The frosted outer-card — radius-lg, 12px padding, 10px gap, shadow-md,
          exactly like `.event-outer-card` on ms.church. */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-white/70 bg-white/95 p-3 shadow-[var(--shadow-md)] backdrop-blur-md transition-shadow duration-[var(--motion-medium)]">
        {/* Header: plain gold uppercase date (left) + time (right). */}
        <div className="flex min-h-7 items-center justify-between px-0.5">
          <span className={HEADER_TEXT}>{displayDate}</span>
          {time && <span className={HEADER_TEXT}>{time}</span>}
        </div>

        {/* Flyer: 3:4, the event's main content on the public site. */}
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-surface shadow-[var(--shadow-md)]">
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
        </div>

        {/* Primary CTA pill (the first live link) or a "View details" pill —
            exactly the two states the site card shows below the flyer. */}
        {showCta ? (
          <span className="btn-cta w-full">{ctaText}</span>
        ) : (
          <span className="btn-cta btn-cta--secondary w-full">View details</span>
        )}
      </div>
    </div>
  )
}

export interface EventDetailPreviewProps {
  title: string
  startsAt: string | null
  endsAt: string | null
  allDay: boolean
  imageUrl: string | null
  location: string | null
  cost: string | null
  ages: string | null
  rsvpBy: string | null
  description: string | null
  /** All live CTAs (primary first); only http(s) links show as buttons. */
  ctas: EventCta[]
}

/** One labeled fact row, matching the site's `.event-fact` dt/dd. */
function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-micro font-bold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="m-0 text-compact leading-snug text-ink">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 border-b border-gold/40 text-gold-dark transition-colors hover:text-gold"
          >
            {label === "Where" && <MapPin size={12} className="shrink-0" />}
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/**
 * The detail lightbox interior, exactly as the site renders it when a visitor
 * taps the flyer. Single column (it lives in the editor's preview rail), but
 * structurally identical to `.event-detail-*` on ms.church.
 */
export function EventDetailPreview({
  title,
  startsAt,
  endsAt,
  allDay,
  imageUrl,
  location,
  cost,
  ages,
  rsvpBy,
  description,
  ctas,
}: EventDetailPreviewProps) {
  const src = flyerRenderSrc(imageUrl)
  const displayDate = startsAt ? eventDisplayDate(startsAt) : null
  const time = startsAt ? eventDisplayTime(startsAt, endsAt, allDay) : null
  const when = [displayDate, time].filter(Boolean).join(" · ")
  const blocks = description?.trim() ? formatEventBlocks(description) : []
  const facts: Array<{ label: string; value: string; href?: string }> = []
  if (location?.trim()) facts.push({ label: "Where", value: location.trim(), href: eventMapsLink(location.trim()) })
  if (cost?.trim()) facts.push({ label: "Cost", value: cost.trim() })
  if (ages?.trim()) facts.push({ label: "Who", value: ages.trim() })
  if (rsvpBy?.trim()) facts.push({ label: "RSVP by", value: rsvpBy.trim() })

  return (
    <div className="w-full max-w-[320px] overflow-hidden rounded-xl border border-ink-hairline bg-bg shadow-[var(--shadow-md)]">
      <div className="flex items-center justify-center bg-surface">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={title || "Event flyer"}
            className="max-h-[40vh] w-full object-contain"
          />
        ) : (
          <span className="grid aspect-[16/9] w-full place-items-center bg-gradient-to-br from-gold to-gold-dark text-[2.5rem]">
            📅
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {when && (
          <span className="text-eyebrow font-bold uppercase tracking-wide text-gold">{when}</span>
        )}
        <h4 className="font-display text-lead font-semibold leading-tight text-ink">
          {title || "Untitled event"}
        </h4>
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-ink-hairline py-3">
            {facts.map((f) => (
              <Fact key={f.label} {...f} />
            ))}
          </dl>
        )}
        {blocks.length > 0 && (
          <div className="text-small leading-normal text-ink-soft">
            {blocks.map((b, i) =>
              b.type === "ul" ? (
                <ul key={i} className="mb-2 list-disc pl-5 last:mb-0">
                  {b.items.map((it, j) => (
                    <li key={j} className="mb-1 last:mb-0">
                      {it}
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={i} className="mb-2 last:mb-0">
                  {b.lines.map((l, j) => (
                    <span key={j}>
                      {l}
                      {j < b.lines.length - 1 && <br />}
                    </span>
                  ))}
                </p>
              ),
            )}
          </div>
        )}
        {ctas.length > 0 && (
          <div className="flex flex-col gap-2">
            {ctas.map((c, i) => (
              <span key={i} className={cn("btn-cta w-full", i > 0 && "btn-cta--secondary")}>
                {c.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
