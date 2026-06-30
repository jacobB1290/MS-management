"use client"
import { Badge } from "@/components/ui/badge"
import { eventLongDate } from "@/lib/event-format"
import {
  SEGMENT_LABEL,
  segmentVariant,
  formatClock,
  formatLength,
  type SermonSegment,
  type SermonSong,
  type SermonFormat,
} from "../../types"

/**
 * A faithful mirror of what ms.church shows for a service, rebuilt live from the
 * editor's working draft so staff see exactly how their edits read on the public
 * site — the watch card (title, format, date, speakers, length, summary, topic
 * chips) plus the chapter and song lists. Chapters + songs render in start order
 * (the same order the site plays them), even while the editor keeps its rows in
 * place, so the operator sees the real sequence.
 */

export interface SermonPreviewData {
  title: string
  format: SermonFormat
  publishedAt: string | null
  speakers: string[]
  durationSec: number | null
  summary: string
  topics: string[]
  segments: SermonSegment[]
  songs: SermonSong[]
}

export function SermonPreview({ data }: { data: SermonPreviewData }) {
  const length = formatLength(data.durationSec)
  const formatNoun = data.format === "discussion" ? "Discussion" : "Sermon"
  const chapters = [...data.segments].sort((a, b) => a.startSec - b.startSec)
  const songs = [...data.songs].sort((a, b) => a.startSec - b.startSec)

  const metaBits = [
    formatNoun,
    data.publishedAt ? eventLongDate(data.publishedAt) : null,
    data.speakers.length ? `with ${data.speakers.join(", ")}` : null,
    length,
  ].filter(Boolean) as string[]

  return (
    <div className="overflow-hidden rounded-xl border border-ink-hairline bg-white">
      <div className="space-y-3 p-4 sm:p-5">
        <div>
          <h3 className="font-display text-lead font-semibold leading-[var(--leading-snug)] text-ink">
            {data.title || <span className="text-ink-fade">Untitled service</span>}
          </h3>
          {metaBits.length > 0 && (
            <p className="mt-1 text-micro text-ink-faint">{metaBits.join(" · ")}</p>
          )}
        </div>

        {data.summary && (
          <p className="text-small leading-[var(--leading-prose)] text-ink-soft">{data.summary}</p>
        )}

        {data.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.topics.map((t) => (
              <span key={t} className="rounded-pill bg-surface px-2.5 py-1 text-micro text-ink-muted">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <PreviewList label="Chapters" count={chapters.length}>
        {chapters.map((seg, i) => (
          <li key={i} className="flex gap-3 px-4 py-2.5 sm:px-5">
            <span className="mt-0.5 inline-flex h-fit shrink-0 items-center rounded-pill bg-surface px-2 py-0.5 font-mono text-micro tabular-nums text-ink-muted">
              {formatClock(seg.startSec)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={segmentVariant(seg.type)}>
                  {SEGMENT_LABEL[seg.type] ?? seg.type}
                </Badge>
                <span className="text-small font-semibold text-ink">
                  {seg.title || <span className="text-ink-fade">Untitled chapter</span>}
                </span>
                {seg.speakers && seg.speakers.length > 0 && (
                  <span className="text-micro text-ink-faint">with {seg.speakers.join(", ")}</span>
                )}
              </span>
              {seg.summary && (
                <span className="mt-0.5 block text-micro leading-[var(--leading-prose)] text-ink-muted">
                  {seg.summary}
                </span>
              )}
              {seg.scriptureRefs.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {seg.scriptureRefs.map((r) => (
                    <span key={r} className="rounded-pill bg-surface px-2 py-0.5 text-micro text-ink-faint">
                      {r}
                    </span>
                  ))}
                </span>
              )}
              {seg.children && seg.children.length > 0 && (
                <span className="mt-1.5 flex flex-col gap-1 border-l border-ink-hairline pl-3">
                  {seg.children.map((c, ci) => (
                    <span key={ci} className="flex items-baseline gap-2">
                      <span className="font-mono text-micro tabular-nums text-ink-faint">
                        {formatClock(c.startSec)}
                      </span>
                      <span className="text-micro text-ink-muted">
                        {c.title || <span className="text-ink-fade">Untitled part</span>}
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          </li>
        ))}
      </PreviewList>

      {songs.length > 0 && (
        <PreviewList label="Songs" count={songs.length}>
          {songs.map((s, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="inline-flex h-fit shrink-0 items-center rounded-pill bg-surface px-2 py-0.5 font-mono text-micro tabular-nums text-ink-muted">
                {formatClock(s.startSec)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-small font-semibold text-ink">
                    {s.title || <span className="text-ink-fade">Untitled song</span>}
                  </span>
                  <Badge variant={s.kind === "program" ? "gold" : "muted"}>
                    {s.kind === "program" ? "Program" : "Worship"}
                  </Badge>
                </span>
                {(s.leader || s.topic) && (
                  <span className="mt-0.5 block text-micro text-ink-faint">
                    {[s.leader, s.topic].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </PreviewList>
      )}
    </div>
  )
}

function PreviewList({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-ink-hairline">
      <p className="px-4 pt-3 text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint sm:px-5">
        {label} <span className="text-ink-fade">· {count}</span>
      </p>
      {count === 0 ? (
        <p className="px-4 pb-3 pt-1.5 text-small text-ink-faint sm:px-5">None yet.</p>
      ) : (
        <ul className="divide-y divide-ink-hairline py-1">{children}</ul>
      )}
    </div>
  )
}
