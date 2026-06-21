import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { formatDistanceToNowStrict } from "date-fns"
import { Play } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { Badge } from "@/components/ui/badge"
import { SectionHeading } from "@/components/ui/section-heading"
import { eventLongDate } from "@/lib/event-format"
import { SermonActions } from "../sermon-actions"
import { SermonThumb } from "../sermon-thumb"
import { PipelineStepsFull } from "../pipeline-steps"
import {
  sermonStatus,
  runStatus,
  segmentVariant,
  SEGMENT_LABEL,
  formatClock,
  formatLength,
  formatElapsed,
  youtubeChapterUrl,
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
        {/* Watch + summary */}
        <section className="grid gap-5 sm:grid-cols-[minmax(0,300px)_1fr] sm:gap-6">
          <a
            href={`https://youtu.be/${sermon.youtube_video_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block aspect-video overflow-hidden rounded-xl border border-ink-hairline bg-surface shadow-sm"
          >
            <SermonThumb
              videoId={sermon.youtube_video_id}
              alt={`${sermon.title} — Morning Star Christian Church, Boise`}
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-black/55 text-white backdrop-blur-sm transition-transform duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] group-hover:scale-110 motion-reduce:transition-none">
                <Play size={20} className="ml-0.5 fill-current" />
              </span>
            </span>
          </a>

          <div className="min-w-0">
            {sermon.summary ? (
              <p className="max-w-prose text-body leading-[var(--leading-prose)] text-ink-soft">
                {sermon.summary}
              </p>
            ) : (
              <p className="text-body text-ink-faint">
                A summary appears once the service has been segmented.
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
          </div>
        </section>

        {/* Chapters */}
        <section aria-label="Chapters">
          <SectionHeading>Chapters</SectionHeading>
          {segments.length === 0 ? (
            <p className="text-body text-ink-faint">
              Chapters appear after the transcript is segmented. Run the pipeline to generate them.
            </p>
          ) : (
            <ol className="overflow-hidden rounded-xl border border-ink-hairline bg-white">
              {segments.map((seg, i) => (
                <li
                  key={i}
                  className="flex gap-4 border-b border-ink-hairline p-4 last:border-b-0 sm:gap-5 sm:p-5"
                >
                  <a
                    href={youtubeChapterUrl(sermon.youtube_video_id, seg.startSec)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex h-fit shrink-0 items-center gap-1 rounded-pill bg-surface px-2.5 py-1 font-mono text-micro tabular-nums text-ink-muted transition-colors hover:bg-[color-mix(in_oklab,var(--gold)_14%,transparent)] hover:text-gold-dark motion-reduce:transition-none"
                  >
                    {formatClock(seg.startSec)}
                  </a>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={segmentVariant(seg.type)}>
                        {SEGMENT_LABEL[seg.type] ?? seg.type}
                      </Badge>
                      <h3 className="text-body font-semibold text-ink">{seg.title}</h3>
                    </div>
                    {seg.summary && (
                      <p className="mt-1 text-small leading-[var(--leading-prose)] text-ink-muted">
                        {seg.summary}
                      </p>
                    )}
                    {seg.scriptureRefs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {seg.scriptureRefs.map((ref) => (
                          <span
                            key={ref}
                            className="rounded-md border border-ink-hairline px-2 py-0.5 text-micro text-ink-muted"
                          >
                            {ref}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Transcript */}
        {sermon.transcript && (
          <section aria-label="Transcript">
            <SectionHeading>Transcript</SectionHeading>
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
