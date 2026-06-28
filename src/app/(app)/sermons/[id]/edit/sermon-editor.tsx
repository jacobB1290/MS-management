"use client"
import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Clock, Crosshair, Music2, Play, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormField } from "@/components/ui/form-field"
import { EditorSection } from "@/components/ui/editor-section"
import { EditorBar } from "@/components/ui/editor-bar"
import { PreviewPanel } from "@/components/ui/preview-panel"
import { PreviewStage } from "@/components/ui/preview-stage"
import { cn } from "@/lib/utils"
import { useYouTubePlayer } from "../../use-youtube-player"
import {
  SEGMENT_LABEL,
  formatClock,
  formatLength,
  parseClock,
  type SermonSegment,
  type SermonSong,
  type SermonFormat,
} from "../../types"
import { SermonPreview, type SermonPreviewData } from "./sermon-preview"

/**
 * The full service editor. Every field ms.church shows is editable here — title,
 * summary, speakers, topics, format, date, thumbnail, SEO, and the chapter +
 * song arrays — so a human can fix anything the model left blank or got slightly
 * wrong. Timestamps are captured straight off the embedded video ("Use current
 * time"), and chapters/songs can be added or removed. The live preview mirrors
 * the public watch view. Built on the shared editor chrome (EditorSection,
 * FormField/quiet, EditorBar, PreviewPanel) and the shared YouTube player hook.
 *
 * Saving a published service pulls it back to review (it leaves ms.church until
 * re-published); "Save & publish" does both in one step.
 */

const SEGMENT_OPTIONS = Object.entries(SEGMENT_LABEL) as [string, string][]

export interface SermonEditorInitial {
  id: string
  youtubeVideoId: string
  title: string
  generatedTitle: string | null
  format: SermonFormat
  publishedAt: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  slug: string | null
  summary: string | null
  transcript: string | null
  speakers: string[]
  topics: string[]
  seo: { description: string; tags: string[] } | null
  segments: SermonSegment[]
  songs: SermonSong[]
  status: string
}

type SegRow = {
  uid: number
  type: string
  title: string
  summary: string
  scriptureRefs: string[]
  start: string
  end: string
}
type SongRow = {
  uid: number
  title: string
  leader: string
  kind: string
  topic: string
  start: string
  end: string
}

let uidSeq = 0
const nextUid = () => ++uidSeq

/** The collapse beat for adding/removing a row — must equal --motion-medium so the splice never undercuts the transition. */
const ROW_MOTION_MS = 300
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function isoToLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function SermonEditor({ initial }: { initial: SermonEditorInitial }) {
  const router = useRouter()
  const { holderRef, ready, curSec, activeClip, seek, getCurrentTime } = useYouTubePlayer(
    initial.youtubeVideoId,
  )

  const [generatedTitle, setGeneratedTitle] = useState(initial.generatedTitle ?? "")
  const [format, setFormat] = useState<SermonFormat>(initial.format)
  const [publishedAt, setPublishedAt] = useState(isoToLocalInput(initial.publishedAt))
  const [summary, setSummary] = useState(initial.summary ?? "")
  const [speakers, setSpeakers] = useState<string[]>(initial.speakers)
  const [topics, setTopics] = useState<string[]>(initial.topics)
  const [seoDescription, setSeoDescription] = useState(initial.seo?.description ?? "")
  const [seoTags, setSeoTags] = useState<string[]>(initial.seo?.tags ?? [])
  const [thumbnailUrl, setThumbnailUrl] = useState(initial.thumbnailUrl ?? "")
  const [durationStr, setDurationStr] = useState(
    initial.durationSec ? String(initial.durationSec) : "",
  )
  const [slug, setSlug] = useState(initial.slug ?? "")
  const [transcript, setTranscript] = useState(initial.transcript ?? "")

  const [segments, setSegments] = useState<SegRow[]>(() =>
    initial.segments.map((s) => ({
      uid: nextUid(),
      type: s.type,
      title: s.title,
      summary: s.summary,
      scriptureRefs: s.scriptureRefs,
      start: formatClock(s.startSec),
      end: formatClock(s.endSec),
    })),
  )
  const [songs, setSongs] = useState<SongRow[]>(() =>
    initial.songs.map((s) => ({
      uid: nextUid(),
      title: s.title,
      leader: s.leader ?? "",
      kind: s.kind,
      topic: s.topic ?? "",
      start: formatClock(s.startSec),
      end: formatClock(s.endSec),
    })),
  )
  // Rows mid-exit: kept rendered for one motion beat so removal collapses instead
  // of snapping. Removal commits after the transition.
  const [exiting, setExiting] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const buildPayload = useCallback(() => {
    const durationSec = durationStr.trim() ? Math.max(0, Math.round(Number(durationStr))) : null
    return {
      generatedTitle: generatedTitle,
      format,
      publishedAt: localInputToIso(publishedAt),
      thumbnailUrl: thumbnailUrl.trim() || null,
      durationSec: durationSec && Number.isFinite(durationSec) ? durationSec : null,
      slug: slug.trim() || null,
      summary,
      transcript: transcript.trim() ? transcript : null,
      speakers,
      topics,
      seo: { description: seoDescription, tags: seoTags },
      segments: segments.map((s) => ({
        startSec: parseClock(s.start),
        endSec: parseClock(s.end),
        type: s.type,
        title: s.title,
        summary: s.summary,
        scriptureRefs: s.scriptureRefs,
      })),
      songs: songs.map((s) => ({
        title: s.title,
        leader: s.leader,
        kind: s.kind,
        topic: s.topic,
        startSec: parseClock(s.start),
        endSec: parseClock(s.end),
      })),
    }
  }, [
    generatedTitle,
    format,
    publishedAt,
    thumbnailUrl,
    durationStr,
    slug,
    summary,
    transcript,
    speakers,
    topics,
    seoDescription,
    seoTags,
    segments,
    songs,
  ])

  const payloadJson = JSON.stringify(buildPayload())
  const [initialJson] = useState(payloadJson)
  const dirty = payloadJson !== initialJson

  // The preview reads the live draft (parsed to seconds), sorted into play order.
  const previewData: SermonPreviewData = useMemo(() => {
    const p = buildPayload()
    return {
      title: p.generatedTitle || initial.title,
      format: p.format,
      publishedAt: p.publishedAt,
      speakers: p.speakers,
      durationSec: p.durationSec,
      summary: p.summary,
      topics: p.topics,
      segments: p.segments as SermonSegment[],
      songs: p.songs as SermonSong[],
    }
  }, [buildPayload, initial.title])

  // ----- row helpers (with symmetric enter/exit collapse) -----
  // Removal collapses the row (grid-rows 1fr→0fr) for one motion beat, then
  // splices — so neighbors slide up instead of snapping. Reduced motion skips
  // straight to the splice (no dead wait).
  const dropAfterCollapse = <T extends { uid: number }>(
    uid: number,
    setRows: React.Dispatch<React.SetStateAction<T[]>>,
  ) => {
    const commit = () => {
      setRows((rows) => rows.filter((r) => r.uid !== uid))
      setExiting((s) => {
        const n = new Set(s)
        n.delete(uid)
        return n
      })
    }
    if (prefersReducedMotion()) {
      commit()
      return
    }
    setExiting((s) => new Set(s).add(uid))
    window.setTimeout(commit, ROW_MOTION_MS)
  }
  const removeSeg = (uid: number) => dropAfterCollapse(uid, setSegments)
  const removeSong = (uid: number) => dropAfterCollapse(uid, setSongs)
  const patchSeg = (uid: number, patch: Partial<SegRow>) =>
    setSegments((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))
  const patchSong = (uid: number, patch: Partial<SongRow>) =>
    setSongs((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)))

  const addSeg = () => {
    const here = formatClock(getCurrentTime())
    setSegments((rows) => [
      ...rows,
      { uid: nextUid(), type: "sermon", title: "", summary: "", scriptureRefs: [], start: here, end: here },
    ])
  }
  const addSong = () => {
    const here = formatClock(getCurrentTime())
    setSongs((rows) => [
      ...rows,
      { uid: nextUid(), title: "", leader: "", kind: "worship", topic: "", start: here, end: here },
    ])
  }

  async function doSave(publish: boolean) {
    if (publish && segments.length === 0) {
      toast.error("Add at least one chapter before publishing.")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/sermons/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(`Couldn’t save: ${json?.error ?? res.status}`)
        return
      }
      if (publish) {
        const pubRes = await fetch(`/api/sermons/${initial.id}/publish`, { method: "POST" })
        const pubJson = await pubRes.json().catch(() => null)
        if (!pubRes.ok) {
          toast.error(
            pubJson?.error === "not_ready"
              ? "Saved, but not ready to publish — add at least one chapter first."
              : `Saved, but publish failed: ${pubJson?.error ?? pubRes.status}`,
          )
          router.push(`/sermons/${initial.id}`)
          router.refresh()
          return
        }
        toast.success("Saved and published. Live on ms.church within ~5 minutes.")
      } else {
        toast.success(
          initial.status === "published"
            ? "Saved. Moved back to review — publish again to put it live."
            : "Saved.",
        )
      }
      router.push(`/sermons/${initial.id}`)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const wasPublished = initial.status === "published"
  const whisper = dirty
    ? wasPublished
      ? "Unsaved changes. Saving takes it off ms.church until you publish again."
      : "Unsaved changes."
    : null

  // Show "Save & publish" whenever publishing is the natural next step — a
  // reviewed service or a live one being edited (it returns to review on save,
  // so the one tap puts it right back up). Gated on the initial status only, so
  // the button never pops in or out mid-edit (doSave still guards on chapters).
  const showPublish = initial.status === "review" || initial.status === "published"

  return (
    <>
      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_clamp(360px,30vw,460px)] xl:gap-[var(--space-xl)]">
        <form
          id="sermon-editor"
          onSubmit={(e) => {
            e.preventDefault()
            void doSave(false)
          }}
          className="w-full min-w-0 max-w-[760px] space-y-[var(--space-2xl)] xl:mx-auto"
        >
          {/* The video workspace: stays in reach while you scroll the chapters,
              so "Use current time" always captures the right moment. */}
          <div className="sticky top-2 z-[5] -mx-1 px-1 pt-1">
            <div className="overflow-hidden rounded-xl border border-ink-hairline bg-black shadow-sm">
              <div className="aspect-video w-full">
                <div ref={holderRef} className="h-full w-full" />
              </div>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-micro text-ink-faint">
              <Clock size={12} />
              {ready ? (
                <>
                  Playhead <span className="font-mono tabular-nums text-ink-muted">{formatClock(curSec)}</span> ·
                  capture it into any start or end below
                </>
              ) : (
                "Loading the video…"
              )}
            </p>
          </div>

          <FormField
            variant="quiet"
            label={<span className="sr-only">Public title</span>}
            htmlFor="gen-title"
          >
            <Input
              variant="quiet"
              id="gen-title"
              value={generatedTitle}
              onChange={(e) => setGeneratedTitle(e.target.value)}
              placeholder="Title shown on ms.church"
              className={cn(
                "h-auto py-1.5 font-display text-title font-semibold",
                "leading-[var(--leading-snug)] tracking-[var(--tracking-tight)]",
                "placeholder:font-normal placeholder:text-ink-fade",
              )}
            />
          </FormField>

          {/* ---- 01 · Details ---- */}
          <EditorSection step="01" title="Details" note="The headline facts every visitor sees first on ms.church.">
            <div className="grid grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-2">
              <FormField variant="quiet" label="Format" htmlFor="format">
                <select
                  id="format"
                  className="field-quiet block h-11 w-full text-body text-ink"
                  value={format}
                  onChange={(e) => setFormat(e.target.value === "discussion" ? "discussion" : "sermon")}
                >
                  <option value="sermon">Sermon (one preacher)</option>
                  <option value="discussion">Discussion (two or more hosts)</option>
                </select>
              </FormField>
              <FormField
                variant="quiet"
                label="Service date"
                htmlFor="published-at"
                hint="Shown as the service date on the site."
              >
                <Input
                  variant="quiet"
                  id="published-at"
                  type="datetime-local"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                  data-dynamic
                />
              </FormField>
            </div>

            <TagField
              label="Speakers"
              htmlFor="speakers"
              values={speakers}
              onChange={setSpeakers}
              placeholder="Add a name and press Enter"
              hint="The preacher, or the hosts of a discussion."
            />

            <FormField variant="quiet" label="Summary" htmlFor="summary" hint="2 to 4 sentences for the watch library.">
              <Textarea
                variant="quiet"
                autoGrow
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="What this service is about, leading with the message's topic."
              />
            </FormField>
          </EditorSection>

          {/* ---- 02 · Chapters ---- */}
          <EditorSection
            step="02"
            title="Chapters"
            note="The service broken into parts. Capture a start or end off the video, drag the moment in by typing mm:ss, and add or remove chapters as needed."
            aside={
              <span className="text-micro text-ink-faint">
                {segments.length} {segments.length === 1 ? "chapter" : "chapters"}
              </span>
            }
          >
            <ul>
              {segments.map((row, i) => (
                <RowShell key={row.uid} exiting={exiting.has(row.uid)}>
                  <div className="mb-3 flex items-center gap-2">
                    <select
                      aria-label="Chapter type"
                      className="field-quiet h-9 w-auto min-w-[8.5rem] text-small text-ink"
                      value={row.type}
                      onChange={(e) => patchSeg(row.uid, { type: e.target.value })}
                    >
                      {SEGMENT_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span className="ml-auto" />
                    <RowRemove label={`Remove chapter ${i + 1}`} onClick={() => removeSeg(row.uid)} />
                  </div>

                  <div className="space-y-[var(--space-md)]">
                    <FormField variant="quiet" label="Title" htmlFor={`seg-title-${row.uid}`}>
                      <Input
                        variant="quiet"
                        id={`seg-title-${row.uid}`}
                        value={row.title}
                        onChange={(e) => patchSeg(row.uid, { title: e.target.value })}
                        placeholder="Short, specific chapter title"
                      />
                    </FormField>
                    <FormField variant="quiet" label="Summary" htmlFor={`seg-sum-${row.uid}`}>
                      <Textarea
                        variant="quiet"
                        autoGrow
                        id={`seg-sum-${row.uid}`}
                        rows={2}
                        value={row.summary}
                        onChange={(e) => patchSeg(row.uid, { summary: e.target.value })}
                        placeholder="One or two sentences on what happens here."
                      />
                    </FormField>
                    <TagField
                      label="Scripture references"
                      htmlFor={`seg-refs-${row.uid}`}
                      values={row.scriptureRefs}
                      onChange={(v) => patchSeg(row.uid, { scriptureRefs: v })}
                      placeholder="e.g. John 14:27"
                    />
                    <div className="grid grid-cols-2 gap-[var(--space-md)]">
                      <TimeField
                        label="Start"
                        value={row.start}
                        onChange={(v) => patchSeg(row.uid, { start: v })}
                        onCapture={() => patchSeg(row.uid, { start: formatClock(getCurrentTime()) })}
                        onSeek={() => seek(parseClock(row.start))}
                        ready={ready}
                      />
                      <TimeField
                        label="End"
                        value={row.end}
                        onChange={(v) => patchSeg(row.uid, { end: v })}
                        onCapture={() => patchSeg(row.uid, { end: formatClock(getCurrentTime()) })}
                        onSeek={() => seek(parseClock(row.end))}
                        ready={ready}
                      />
                    </div>
                  </div>
                </RowShell>
              ))}
            </ul>
            <AddRowButton onClick={addSeg} label="Add chapter" />
          </EditorSection>

          {/* ---- 03 · Songs ---- */}
          <EditorSection
            step="03"
            title="Songs"
            note="Each song a visitor can play from the Songs library, with the exact clip bounds."
            aside={
              <span className="text-micro text-ink-faint">
                {songs.length} {songs.length === 1 ? "song" : "songs"}
              </span>
            }
          >
            <ul>
              {songs.map((row, i) => {
                const playing = activeClip === i
                return (
                  <RowShell key={row.uid} exiting={exiting.has(row.uid)}>
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-pill",
                          playing ? "bg-gold text-white" : "bg-surface text-ink-muted",
                        )}
                      >
                        <Music2 size={14} />
                      </span>
                      <select
                        aria-label="Song kind"
                        className="field-quiet h-9 w-auto min-w-[7.5rem] text-small text-ink"
                        value={row.kind}
                        onChange={(e) => patchSong(row.uid, { kind: e.target.value })}
                      >
                        <option value="worship">Worship</option>
                        <option value="program">Program</option>
                      </select>
                      <span className="ml-auto" />
                      <RowRemove label={`Remove song ${i + 1}`} onClick={() => removeSong(row.uid)} />
                    </div>
                    <div className="space-y-[var(--space-md)]">
                      <div className="grid grid-cols-1 gap-[var(--space-md)] sm:grid-cols-2">
                        <FormField variant="quiet" label="Title" htmlFor={`song-title-${row.uid}`}>
                          <Input
                            variant="quiet"
                            id={`song-title-${row.uid}`}
                            value={row.title}
                            onChange={(e) => patchSong(row.uid, { title: e.target.value })}
                            placeholder="Song name"
                          />
                        </FormField>
                        <FormField
                          variant="quiet"
                          htmlFor={`song-leader-${row.uid}`}
                          label={
                            <>
                              Led by<span className="font-normal text-ink-faint"> · optional</span>
                            </>
                          }
                        >
                          <Input
                            variant="quiet"
                            id={`song-leader-${row.uid}`}
                            value={row.leader}
                            onChange={(e) => patchSong(row.uid, { leader: e.target.value })}
                            placeholder="Performer or worship team"
                          />
                        </FormField>
                      </div>
                      <FormField
                        variant="quiet"
                        htmlFor={`song-topic-${row.uid}`}
                        label={
                          <>
                            Topic<span className="font-normal text-ink-faint"> · optional</span>
                          </>
                        }
                      >
                        <Input
                          variant="quiet"
                          id={`song-topic-${row.uid}`}
                          value={row.topic}
                          onChange={(e) => patchSong(row.uid, { topic: e.target.value })}
                          placeholder="One theme keyword"
                        />
                      </FormField>
                      <div className="grid grid-cols-2 gap-[var(--space-md)]">
                        <TimeField
                          label="Clip start"
                          value={row.start}
                          onChange={(v) => patchSong(row.uid, { start: v })}
                          onCapture={() => patchSong(row.uid, { start: formatClock(getCurrentTime()) })}
                          onSeek={() => seek(parseClock(row.start), parseClock(row.end), i)}
                          ready={ready}
                        />
                        <TimeField
                          label="Clip end"
                          value={row.end}
                          onChange={(v) => patchSong(row.uid, { end: v })}
                          onCapture={() => patchSong(row.uid, { end: formatClock(getCurrentTime()) })}
                          onSeek={() => seek(parseClock(row.end))}
                          ready={ready}
                        />
                      </div>
                    </div>
                  </RowShell>
                )
              })}
            </ul>
            <AddRowButton onClick={addSong} label="Add song" />
          </EditorSection>

          {/* ---- 04 · Discovery & SEO ---- */}
          <EditorSection
            step="04"
            title="Discovery & SEO"
            note="How the service is found — topic chips and filters on the site, plus the search-engine snippet."
          >
            <TagField
              label="Topics"
              htmlFor="topics"
              values={topics}
              onChange={setTopics}
              placeholder="Add a topic and press Enter"
              lowercase
              hint="Drives the site's topic filters and topic pages."
            />
            <FormField
              variant="quiet"
              label="Meta description"
              htmlFor="seo-desc"
              hint={`${seoDescription.length} characters · aim for about 155.`}
            >
              <Textarea
                variant="quiet"
                autoGrow
                id="seo-desc"
                rows={2}
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder="A single search-engine description of the service."
              />
            </FormField>
            <TagField
              label="SEO keywords"
              htmlFor="seo-tags"
              values={seoTags}
              onChange={setSeoTags}
              placeholder="Add a keyword and press Enter"
              lowercase
            />
            <FormField
              variant="quiet"
              htmlFor="thumb"
              label={
                <>
                  Thumbnail URL<span className="font-normal text-ink-faint"> · optional</span>
                </>
              }
              hint="Override the poster image. Leave blank to use the YouTube thumbnail."
            >
              <Input
                variant="quiet"
                id="thumb"
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="https://…"
                inputMode="url"
              />
            </FormField>
          </EditorSection>

          {/* ---- 05 · Advanced ---- */}
          <EditorSection
            step="05"
            title="Advanced"
            note="The original source title, the public URL, length, and the full transcript."
          >
            <FormField variant="quiet" label="Original YouTube title" htmlFor="orig-title">
              <Input variant="quiet" id="orig-title" value={initial.title} readOnly disabled />
            </FormField>
            <div className="grid grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-2">
              <FormField
                variant="quiet"
                label="URL slug"
                htmlFor="slug"
                hint="Changing this changes the public link on ms.church."
              >
                <Input
                  variant="quiet"
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="service-2026-06-21"
                />
              </FormField>
              <FormField
                variant="quiet"
                label="Duration (seconds)"
                htmlFor="duration"
                hint={
                  durationStr.trim() && Number(durationStr) > 0
                    ? `≈ ${formatLength(Number(durationStr))}`
                    : "Bounds every timestamp."
                }
              >
                <Input
                  variant="quiet"
                  id="duration"
                  type="number"
                  min={0}
                  value={durationStr}
                  onChange={(e) => setDurationStr(e.target.value)}
                  placeholder="2580"
                  data-dynamic
                />
              </FormField>
            </div>
            <FormField variant="quiet" label="Transcript" htmlFor="transcript">
              <Textarea
                variant="quiet"
                id="transcript"
                rows={8}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="The full service transcript."
                className="max-h-[28rem] font-mono text-small"
              />
            </FormField>
          </EditorSection>

          {/* Inline preview below xl, where the side panel is hidden. */}
          <div className="xl:hidden">
            <PreviewStage variant="bare" label="On ms.church" caption="How the service reads on the public site.">
              <SermonPreview data={previewData} />
            </PreviewStage>
          </div>
        </form>

        <PreviewPanel>
          <PreviewStage
            variant="bare"
            label="On ms.church"
            caption="A live mirror of the public watch view. Chapters and songs show in play order."
          >
            <SermonPreview data={previewData} />
          </PreviewStage>
        </PreviewPanel>
      </div>

      <EditorBar
        formId="sermon-editor"
        submitLabel="Save"
        busy={saving}
        whisper={whisper}
        onCancel={() => router.push(`/sermons/${initial.id}`)}
        secondary={
          showPublish ? (
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void doSave(true)}
            >
              Save &amp; publish
            </Button>
          ) : undefined
        }
      />
    </>
  )
}

/**
 * A chapter/song editor card that expands in on add and collapses out on remove,
 * so neighbors slide rather than snap. Uses the grid-rows 0fr↔1fr collapse (the
 * same honest, height-exact technique as the event editor's reveal) — the whole
 * 300ms is real motion, no max-height approximation. `exiting` drives the
 * collapse before the parent splices; on mount it expands from closed.
 */
function RowShell({ exiting, children }: { exiting: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])
  const shown = open && !exiting
  return (
    <li
      className={cn(
        "grid transition-all duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      {/* The spacing lives inside the collapsing area so the gap closes with the
          row — no orphaned margin during the collapse. */}
      <div className="min-h-0 overflow-hidden">
        <div className="pt-[var(--space-md)]">
          <div className="rounded-xl border border-ink-hairline bg-white p-4 sm:p-5">{children}</div>
        </div>
      </div>
    </li>
  )
}

function RowRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-ink-faint transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-danger/10 hover:text-danger motion-reduce:transition-none"
    >
      <X size={16} />
    </button>
  )
}

function AddRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-[var(--space-md)] inline-flex min-h-11 items-center gap-1.5 text-small font-medium text-gold-dark underline-offset-4 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-gold hover:underline motion-reduce:transition-none"
    >
      <Plus size={15} />
      {label}
    </button>
  )
}

/** A mm:ss field with capture-from-playhead + jump-to actions. */
function TimeField({
  label,
  value,
  onChange,
  onCapture,
  onSeek,
  ready,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onCapture: () => void
  onSeek: () => void
  ready: boolean
}) {
  const id = `time-${useId()}`
  return (
    <FormField variant="quiet" label={label} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <Input
          variant="quiet"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0:00"
          inputMode="numeric"
          className="font-mono tabular-nums"
        />
        <button
          type="button"
          aria-label={`Set ${label.toLowerCase()} to the current playhead`}
          title="Use current time"
          onClick={onCapture}
          disabled={!ready}
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-gold-dark transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-gold/10 hover:text-gold disabled:opacity-40 motion-reduce:transition-none"
        >
          <Crosshair size={16} />
        </button>
        <button
          type="button"
          aria-label={`Jump the video to ${label.toLowerCase()}`}
          title="Jump the video here"
          onClick={onSeek}
          disabled={!ready}
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-surface hover:text-ink disabled:opacity-40 motion-reduce:transition-none"
        >
          <Play size={15} />
        </button>
      </div>
    </FormField>
  )
}

/** A simple chip list: type a value, press Enter or comma to add; backspace on an empty field removes the last. */
function TagField({
  label,
  htmlFor,
  values,
  onChange,
  placeholder,
  hint,
  lowercase,
}: {
  label: React.ReactNode
  htmlFor: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  hint?: React.ReactNode
  lowercase?: boolean
}) {
  const [text, setText] = useState("")
  // Chips collapse their width away on remove instead of vanishing, so the row
  // reflows smoothly. Reduced motion drops the chip immediately.
  const [exitingTags, setExitingTags] = useState<Set<string>>(new Set())

  const add = () => {
    const v = (lowercase ? text.toLowerCase() : text).trim()
    if (!v) return
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v])
    setText("")
  }

  const removeTag = (v: string) => {
    if (prefersReducedMotion()) {
      onChange(values.filter((x) => x !== v))
      return
    }
    setExitingTags((s) => new Set(s).add(v))
    window.setTimeout(() => {
      onChange(values.filter((x) => x !== v))
      setExitingTags((s) => {
        const n = new Set(s)
        n.delete(v)
        return n
      })
    }, 200)
  }

  return (
    <FormField variant="quiet" label={label} htmlFor={htmlFor} hint={hint}>
      <div className="field-quiet flex min-h-11 flex-wrap items-center gap-1.5 py-1.5">
        {values.map((v, i) => {
          const leaving = exitingTags.has(v)
          return (
            <span
              key={`${v}-${i}`}
              className={cn(
                "inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-pill bg-surface py-1 text-micro text-ink-muted",
                "transition-all duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                leaving ? "max-w-0 px-0 opacity-0" : "max-w-[14rem] px-2.5 opacity-100",
                !leaving && "animate-[fade-in_var(--motion-fast)_var(--ease-out-soft)] motion-reduce:animate-none",
              )}
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => removeTag(v)}
                className="shrink-0 text-ink-faint transition-colors duration-[var(--motion-fast)] hover:text-danger motion-reduce:transition-none"
              >
                <X size={12} />
              </button>
            </span>
          )
        })}
        <input
          id={htmlFor}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add()
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={add}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
        />
      </div>
    </FormField>
  )
}
