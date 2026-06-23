import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Badge } from "@/components/ui/badge"
import { SectionHeading } from "@/components/ui/section-heading"
import { eventLongDate } from "@/lib/event-format"
import { SermonActions } from "../sermon-actions"
import { PipelineStepsFull } from "../pipeline-steps"
import { SegmentPlayer, type ClientSong } from "./segment-player"
import { TranscriptActions } from "./transcript-actions"
import {
  sermonStatus,
  runStatus,
  formatLength,
  formatElapsed,
  type SermonSegment,
  type SermonSeo,
  type PipelineStep,
} from "../types"

export const metadata: Metadata = { title: "Sermon" }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SermonDetailPage({ params }: PageProps) {
  const user = await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: sermon } = await supabase.from("sermons").select("*").eq("id", id).maybeSingle()
  if (!sermon) notFound()

  const { data: runsData } = await supabase
    .from("sermon_pipeline_runs")
    .select("id, status, trigger, steps, started_at, finished_at")
    .eq("sermon_id", id)
    .order("started_at", { ascending: false })
    .limit(8)

  const status = sermonStatus(sermon.status)
  const segments = (Array.isArray(sermon.segments) ? sermon.segments : []) as SermonSegment[]
  const songs = (Array.isArray(sermon.songs) ? sermon.songs : []) as ClientSong[]
  const seo = (sermon.seo ?? null) as SermonSeo
  const runs = (runsData ?? []) as {
    id: string
    status: string
    trigger: string
    steps: unknown
    started_at: string
    finished_at: string | null
  }[]
  const length = formatLength(sermon.duration_sec)
  const when = sermon.published_at ?? sermon.created_at
  const ready = segments.length > 0 && sermon.status !== "published"

  const actions = (
    <SermonActions
      id={sermon.id}
      youtubeVideoId={sermon.youtube_video_id}
      status={sermon.status}
      ready={ready}
      isAdmin={user.role === "admin"}
    />
  )
  const meta = (
    <>
      <Badge variant={status.variant}>{status.label}</Badge>
      <span className="text-small text-ink-muted">{eventLongDate(when)}</span>
      {(segments.length > 0 || length) && (
        <span className="text-micro text-ink-faint">
          {segments.length > 0 ? `${segments.length} chapters` : ""}
          {segments.length > 0 && length ? " · " : ""}
          {length ?? ""}
        </span>
      )}
    </>
  )

  return (
    <DetailScaffold
      eyebrow="Sermon"
      title={sermon.title}
      backHref="/sermons"
      backLabel="All sermons"
      actions={actions}
      meta={meta}
    >
      <div className="space-y-12 pt-6">
        {/* Summary + tags */}
        {(sermon.summary || (seo?.tags?.length ?? 0) > 0) && (
          <section aria-label="Summary">
            {sermon.summary && (
              <p className="max-w-prose text-body leading-[var(--leading-prose)] text-ink-soft">
                {sermon.summary}
              </p>
            )}
            {seo?.tags && seo.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {seo.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-pill bg-surface px-2.5 py-1 text-micro text-ink-muted"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Review the segmentation: play the video against the chapters + songs */}
        <section aria-label="Review the segmentation">
          <SectionHeading>Review the segmentation</SectionHeading>
          {segments.length === 0 ? (
            <p className="text-body text-ink-faint">
              Chapters appear after the transcript is segmented. Run the pipeline to generate them.
            </p>
          ) : (
            <SegmentPlayer
              videoId={sermon.youtube_video_id}
              segments={segments}
              songs={songs}
            />
          )}
        </section>

        {/* Transcript */}
        {sermon.transcript && (
          <section aria-label="Transcript">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="font-display text-lead font-medium text-ink">Transcript</h2>
              <span
                className="hidden h-px flex-1 bg-gradient-to-r from-ink-hairline to-transparent sm:block"
                aria-hidden
              />
              <div className="w-full sm:w-auto">
                <TranscriptActions sermonId={sermon.id} plain={sermon.transcript} />
              </div>
            </div>
            <div className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-xl border border-ink-hairline bg-surface/50 p-5">
              <p className="max-w-prose whitespace-pre-wrap text-small leading-[var(--leading-prose)] text-ink-soft">
                {sermon.transcript}
              </p>
            </div>
          </section>
        )}

        {/* SEO preview */}
        {seo?.description && (
          <section aria-label="Search preview">
            <SectionHeading>Search preview</SectionHeading>
            <div className="rounded-xl border border-ink-hairline bg-white p-5">
              <p className="text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
                Meta description
              </p>
              <p className="mt-1.5 max-w-prose text-small leading-[var(--leading-prose)] text-ink-soft">
                {seo.description}
              </p>
            </div>
          </section>
        )}

        {/* Run history (the per-sermon monitor) */}
        {runs.length > 0 && (
          <section aria-label="Pipeline history">
            <SectionHeading>Pipeline history</SectionHeading>
            <div className="space-y-3">
              {runs.map((run) => {
                const rs = runStatus(run.status)
                const steps = (Array.isArray(run.steps) ? run.steps : []) as PipelineStep[]
                const took = formatElapsed(run.started_at, run.finished_at)
                return (
                  <div
                    key={run.id}
                    className="rounded-xl border border-ink-hairline bg-white p-4 animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)] motion-reduce:animate-none sm:p-5"
                  >
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <Badge variant={rs.variant}>{rs.label}</Badge>
                      <span className="text-small capitalize text-ink-muted">{run.trigger}</span>
                      <span className="text-micro text-ink-faint">
                        · {formatDistanceToNowStrict(new Date(run.started_at), { addSuffix: true })}
                        {took ? ` · ${took}` : ""}
                      </span>
                    </div>
                    <PipelineStepsFull steps={steps} />
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </DetailScaffold>
  )
}
