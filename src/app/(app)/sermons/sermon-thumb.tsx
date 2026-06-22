"use client"
import { useState } from "react"
import { Youtube } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * YouTube thumbnail with a quiet icon tile always behind it, so a loading or
 * missing frame never shows the browser's broken-image glyph or sprawling alt
 * text — you see an intentional play-icon tile until (and unless) the real frame
 * paints over it. The source walks a fallback ladder: maxresdefault (crisp, but
 * absent on some uploads) → hqdefault (exists for every valid video) → drop the
 * img entirely and leave the icon. Client-only because the swap is an onError
 * reaction; the descriptive text rides on the wrapper's aria-label, and the img
 * itself is decorative (alt="").
 */
export function SermonThumb({
  videoId,
  alt,
  className,
}: {
  videoId: string | null
  alt: string
  className?: string
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  const showImg = Boolean(videoId) && stage < 2
  const file = stage === 0 ? "maxresdefault" : "hqdefault"

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn("relative block h-full w-full overflow-hidden bg-surface", className)}
    >
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center text-ink-faint"
      >
        <Youtube size={28} />
      </span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://img.youtube.com/vi/${videoId}/${file}.jpg`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setStage((s) => (s === 0 ? 1 : 2))}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      )}
    </span>
  )
}
