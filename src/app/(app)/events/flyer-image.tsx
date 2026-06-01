"use client"
import { useState } from "react"
import { CalendarDays } from "lucide-react"
import { cn } from "@/lib/utils"
import { flyerRenderSrc } from "@/lib/event-format"

/**
 * Renders an event flyer, routed through the same-origin proxy (see
 * flyerRenderSrc), with a smooth fade-in and a graceful fall back to the
 * calendar placeholder if the image is missing or fails to load — so a flaky
 * Drive image never leaves a broken-image glyph on a card.
 */
export function FlyerImage({
  url,
  alt,
  iconSize = 32,
  className,
}: {
  url: string | null
  alt: string
  iconSize?: number
  className?: string
}) {
  const src = flyerRenderSrc(url)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gold/15 to-gold-dark/15 text-gold">
        <CalendarDays size={iconSize} strokeWidth={1.5} />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={cn(
        "h-full w-full object-cover transition-[opacity,transform] duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        loaded ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  )
}
