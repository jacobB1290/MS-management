"use client"
import { AlertTriangle, Music2, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { segmentVariant, SEGMENT_LABEL, formatClock, type SermonSegment } from "../types"
import { useYouTubePlayer } from "../use-youtube-player"

/**
 * In-page verification player. Embeds the service video and lets staff click any
 * chapter to seek there, or play a song's exact [start, end] clip (the same clip
 * the public site plays), so the segmentation can be checked against the real
 * footage without opening YouTube. Songs whose midpoint lands inside the sermon
 * are flagged ("check placement") — that is the failure mode where a correctly
 * named song clip would play the message. The YouTube controller is the shared
 * `useYouTubePlayer` hook, also used by the service editor.
 */

export type ClientSong = {
  title: string
  leader: string | null
  kind: string
  topic: string | null
  startSec: number
  endSec: number
}

export function SegmentPlayer({
  videoId,
  segments,
  songs,
}: {
  videoId: string
  segments: SermonSegment[]
  songs: ClientSong[]
}) {
  const { holderRef, curSec, activeClip, seek } = useYouTubePlayer(videoId)

  // Which chapter the playhead is in right now (live highlight while watching).
  let activeChapter = -1
  for (let i = 0; i < segments.length; i++) {
    if (curSec + 0.25 >= segments[i].startSec) activeChapter = i
  }

  // The mis-placement flag: a worship/program song is never sung during the
  // message, so a song whose midpoint sits inside a sermon/discussion chapter is
  // almost certainly mis-bound (the exact "song clip plays the sermon" failure).
  const messageSpans = segments
    .filter((s) => s.type === "sermon" || s.type === "discussion")
    .map((s) => [s.startSec, s.endSec] as const)
  const looksOff = (s: ClientSong) => {
    const mid = (s.startSec + s.endSec) / 2
    return messageSpans.some(([a, b]) => mid > a + 5 && mid < b - 5)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,460px)_1fr]">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="aspect-video overflow-hidden rounded-xl border border-ink-hairline bg-black shadow-sm">
          <div ref={holderRef} className="h-full w-full" />
        </div>
        <p className="mt-2 text-micro text-ink-faint">
          Click a chapter to jump there, or play a song to hear its exact clip and confirm it lands
          on the music.
        </p>
      </div>

      <div className="space-y-8">
        {/* Chapters */}
        <div>
          <p className="mb-3 text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
            Chapters
          </p>
          <ol className="overflow-hidden rounded-xl border border-ink-hairline bg-white">
            {segments.map((seg, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => seek(seg.startSec, null, null)}
                  aria-current={activeChapter === i}
                  className={cn(
                    "flex w-full gap-3 border-b border-ink-hairline p-3 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] last:border-b-0 hover:bg-surface motion-reduce:transition-none sm:gap-4 sm:p-4",
                    activeChapter === i && "bg-[color-mix(in_oklab,var(--gold)_8%,white)]",
                  )}
                >
                  <span className="mt-0.5 inline-flex h-fit shrink-0 items-center rounded-pill bg-surface px-2.5 py-1 font-mono text-micro tabular-nums text-ink-muted">
                    {formatClock(seg.startSec)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={segmentVariant(seg.type)}>
                        {SEGMENT_LABEL[seg.type] ?? seg.type}
                      </Badge>
                      <span className="text-small font-semibold text-ink">{seg.title}</span>
                      {seg.speakers && seg.speakers.length > 0 && (
                        <span className="text-micro text-ink-faint">with {seg.speakers.join(", ")}</span>
                      )}
                    </span>
                    {seg.summary && (
                      <span className="mt-1 block text-micro leading-[var(--leading-prose)] text-ink-muted">
                        {seg.summary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        {/* Songs */}
        <div>
          <p className="mb-3 text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
            Songs <span className="text-ink-fade">· {songs.length}</span>
          </p>
          {songs.length === 0 ? (
            <p className="rounded-xl border border-ink-hairline bg-surface/50 p-4 text-small text-ink-faint">
              No songs were detected for this service.
            </p>
          ) : (
            <ul className="space-y-2">
              {songs.map((s, i) => {
                const off = looksOff(s)
                const playing = activeClip === i
                const clipLen = Math.max(1, s.endSec - s.startSec)
                const prog = playing ? Math.min(1, Math.max(0, (curSec - s.startSec) / clipLen)) : 0
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => seek(s.startSec, s.endSec, i)}
                      className={cn(
                        "relative w-full overflow-hidden rounded-xl border bg-white p-3 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] hover:bg-surface motion-reduce:transition-none sm:p-4",
                        off ? "border-warning/60" : "border-ink-hairline",
                        playing && "border-gold",
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-pill",
                            playing ? "bg-gold text-white" : "bg-surface text-ink-muted",
                          )}
                        >
                          {playing ? <Music2 size={16} /> : <Play size={16} className="ml-0.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-small font-semibold text-ink">{s.title}</span>
                            <Badge variant={s.kind === "program" ? "gold" : "muted"}>
                              {s.kind === "program" ? "Program" : "Worship"}
                            </Badge>
                            {off && (
                              <span className="inline-flex items-center gap-1 text-micro font-medium text-warning">
                                <AlertTriangle size={12} /> check placement
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-micro text-ink-faint">
                            {formatClock(s.startSec)} – {formatClock(s.endSec)}
                            {s.leader ? ` · ${s.leader}` : ""}
                            {s.topic ? ` · ${s.topic}` : ""}
                          </span>
                        </span>
                      </span>
                      {playing && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-gold/30"
                        >
                          <span
                            className="block h-full bg-gold"
                            style={{ width: `${prog * 100}%` }}
                          />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
