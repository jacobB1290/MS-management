import type { Metadata } from "next"
import Link from "next/link"
import { formatDistanceToNowStrict } from "date-fns"
import { Mic } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { isAiEnabled } from "@/server/ai/client"
import { hasCaptionAccess } from "@/server/youtube/captions"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PageMasthead } from "@/components/ui/page-masthead"
import { PageScaffold } from "@/components/ui/page-scaffold"
import { SectionHeading } from "@/components/ui/section-heading"
import { Table, TableCard, Th, Tr, Td } from "@/components/ui/table"
import { eventDisplayDate, eventLongDate } from "@/lib/event-format"
import { SermonsToolbar } from "./sermons-toolbar"
import { SermonThumb } from "./sermon-thumb"
import { PipelineStepsCompact } from "./pipeline-steps"
import {
  sermonStatus,
  runStatus,
  formatLength,
  formatElapsed,
  type PipelineStep,
  type SermonSegment,
} from "./types"

export const metadata: Metadata = { title: "Sermons" }

type SermonRow = {
  id: string
  youtube_video_id: string
  slug: string | null
  title: string
  status: string
  published_at: string | null
  created_at: string
  thumbnail_url: string | null
  duration_sec: number | null
  summary: string | null
  segments: unknown
}

type RunRow = {
  id: string
  youtube_video_id: string
  status: string
  trigger: string
  steps: unknown
  started_at: string
  finished_at: string | null
  sermon_id: string | null
}

export default async function SermonsPage() {
  await requireStaff()
  const supabase = await createSupabaseServerClient()

  const [{ data: sermonsData }, { data: runsData }] = await Promise.all([
    supabase
      .from("sermons")
      .select(
        "id, youtube_video_id, slug, title, status, published_at, created_at, thumbnail_url, duration_sec, summary, segments",
      )
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("sermon_pipeline_runs")
      .select("id, youtube_video_id, status, trigger, steps, started_at, finished_at, sermon_id")
      .order("started_at", { ascending: false })
      .limit(12),
  ])

  const sermons = (sermonsData ?? []) as SermonRow[]
  const runs = (runsData ?? []) as RunRow[]

  // Titles for the runs table without an embedded select (keeps typing simple).
  const titleById = new Map(sermons.map((s) => [s.id, s]))

  const captionsReady = hasCaptionAccess()
  const aiReady = isAiEnabled()
  const lastRun = runs[0] ?? null

  const [latest, ...rest] = sermons

  return (
    <PageScaffold
      header={
        <PageMasthead
          title="Sermons"
          description="Sunday services, transcribed and chaptered for ms.church."
          actions={<SermonsToolbar />}
        />
      }
    >
      <div className="pt-5">
        <StatusBand
          captionsReady={captionsReady}
          aiReady={aiReady}
          lastRun={lastRun}
        />
      </div>

      {sermons.length === 0 && runs.length === 0 ? (
        <div className="py-10">
          <EmptyState
            icon={<Mic size={26} />}
            title="No sermons yet"
            body="Each Sunday the pipeline pulls the newest service video, transcribes it, and chapters it for review. Tap Run now to process the latest one immediately, or wait for the Monday run."
          />
        </div>
      ) : (
        <>
          {latest && (
            <section aria-label="Latest service" className="pt-8">
              <SectionHeading>Latest</SectionHeading>
              <SermonFeature sermon={latest} />
              {rest.length > 0 && (
                <div className="mt-4 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                  {rest.map((s) => (
                    <SermonPoster key={s.id} sermon={s} />
                  ))}
                </div>
              )}
            </section>
          )}

          {runs.length > 0 && (
            <section
              aria-label="Recent activity"
              className="mt-12 border-t border-ink-hairline pt-6 animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)_backwards]"
            >
              <SectionHeading>Recent activity</SectionHeading>
              <RunsTable runs={runs} titleById={titleById} />
            </section>
          )}
        </>
      )}
    </PageScaffold>
  )
}

/* ----------------------------------------------------------------------- */
/* Control-panel status band                                                */
/* ----------------------------------------------------------------------- */

function StatusBand({
  captionsReady,
  aiReady,
  lastRun,
}: {
  captionsReady: boolean
  aiReady: boolean
  lastRun: RunRow | null
}) {
  const last = lastRun
    ? runStatus(lastRun.status)
    : { label: "No runs yet", variant: "muted" as const }
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-hairline bg-white shadow-sm">
      {/* gap-px over a hairline backdrop draws clean dividers that adapt to the
          2-col (mobile) / 4-col (desktop) wrap without per-cell border math. */}
      <div className="grid grid-cols-2 gap-px bg-ink-hairline md:grid-cols-4">
        <StatCell label="Last run">
          <span className="flex items-center gap-2">
            <Dot variant={last.variant} pulse={lastRun?.status === "running"} />
            <span className="text-body font-medium text-ink">
              {lastRun
                ? formatDistanceToNowStrict(new Date(lastRun.started_at), { addSuffix: true })
                : "—"}
            </span>
          </span>
          <span className="text-micro text-ink-faint">{last.label}</span>
        </StatCell>

        <StatCell label="Next run">
          <span className="text-body font-medium text-ink">Monday ~12pm</span>
          <span className="text-micro text-ink-faint">Weekly · Boise time</span>
        </StatCell>

        <StatCell label="YouTube captions">
          <span className="flex items-center gap-2">
            <Dot variant={captionsReady ? "success" : "warning"} />
            <span className="text-body font-medium text-ink">
              {captionsReady ? "Connected" : "Needs setup"}
            </span>
          </span>
          <span className="text-micro text-ink-faint">
            {captionsReady ? "Owner OAuth ready" : "Add youtube.force-ssl"}
          </span>
        </StatCell>

        <StatCell label="AI segmentation">
          <span className="flex items-center gap-2">
            <Dot variant={aiReady ? "success" : "warning"} />
            <span className="text-body font-medium text-ink">{aiReady ? "On" : "Off"}</span>
          </span>
          <span className="text-micro text-ink-faint">
            {aiReady ? "Claude · switch in Settings" : "No Anthropic key"}
          </span>
        </StatCell>
      </div>

      {!captionsReady && (
        <p className="border-t border-ink-hairline bg-surface/60 px-4 py-2.5 text-micro text-ink-muted">
          Transcription waits on a Google OAuth token with the{" "}
          <code className="rounded bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] px-1 py-0.5">
            youtube.force-ssl
          </code>{" "}
          scope. Setup steps: <span className="text-ink">docs/sermons-youtube-setup-runbook.md</span>.
        </p>
      )}
    </div>
  )
}

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-white px-4 py-3.5">
      <span className="text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
        {label}
      </span>
      {children}
    </div>
  )
}

function Dot({
  variant,
  pulse,
}: {
  variant: "success" | "warning" | "danger" | "gold" | "muted" | "default"
  pulse?: boolean
}) {
  const bg =
    variant === "success"
      ? "bg-success"
      : variant === "warning"
        ? "bg-warning"
        : variant === "danger"
          ? "bg-danger"
          : variant === "gold"
            ? "bg-gold"
            : "bg-[color-mix(in_oklab,var(--ink)_28%,transparent)]"
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-pill ${bg} ${pulse ? "live-dot" : ""}`}
    />
  )
}

/* ----------------------------------------------------------------------- */
/* Sermon cards                                                             */
/* ----------------------------------------------------------------------- */

function chapterCount(segments: unknown): number {
  return Array.isArray(segments) ? (segments as SermonSegment[]).length : 0
}

function SermonFeature({ sermon }: { sermon: SermonRow }) {
  const status = sermonStatus(sermon.status)
  const chapters = chapterCount(sermon.segments)
  const length = formatLength(sermon.duration_sec)
  const when = sermon.published_at ?? sermon.created_at
  return (
    <Link
      href={`/sermons/${sermon.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] hover:shadow-md motion-reduce:transition-none sm:flex-row"
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-surface sm:w-64 md:w-80">
        <SermonThumb
          videoId={sermon.youtube_video_id}
          alt={`${sermon.title} — Morning Star Christian Church`}
        />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-5 sm:p-6 md:p-8">
        <span className="eyebrow text-gold">Most recent</span>
        <h3 className="font-display text-lead leading-[var(--leading-snug)] text-ink">
          {sermon.title}
        </h3>
        {sermon.summary && (
          <p className="line-clamp-2 max-w-prose text-small text-ink-muted">{sermon.summary}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-small text-ink-muted">{eventLongDate(when)}</span>
          {(chapters > 0 || length) && (
            <span className="text-micro text-ink-faint">
              {chapters > 0 ? `${chapters} chapters` : ""}
              {chapters > 0 && length ? " · " : ""}
              {length ?? ""}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

function SermonPoster({ sermon }: { sermon: SermonRow }) {
  const status = sermonStatus(sermon.status)
  const chapters = chapterCount(sermon.segments)
  const when = sermon.published_at ?? sermon.created_at
  return (
    <Link
      href={`/sermons/${sermon.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-hairline bg-white shadow-sm transition-shadow duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] hover:shadow-md motion-reduce:transition-none"
    >
      <div className="relative aspect-video overflow-hidden bg-surface">
        <SermonThumb
          videoId={sermon.youtube_video_id}
          alt={`${sermon.title} — Morning Star Christian Church`}
        />
        <span className="absolute left-2 top-2">
          <Badge variant={status.variant} className="shadow-sm">
            {status.label}
          </Badge>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <span className="font-display text-body leading-tight text-gold">
          {eventDisplayDate(when)}
        </span>
        <span className="line-clamp-2 text-small font-medium text-ink">{sermon.title}</span>
        {chapters > 0 && <span className="text-micro text-ink-faint">{chapters} chapters</span>}
      </div>
    </Link>
  )
}

/* ----------------------------------------------------------------------- */
/* Runs monitor table                                                       */
/* ----------------------------------------------------------------------- */

function RunsTable({
  runs,
  titleById,
}: {
  runs: RunRow[]
  titleById: Map<string, SermonRow>
}) {
  return (
    <TableCard>
      <Table>
        <thead>
          <tr className="border-b border-ink-hairline">
            <Th>Status</Th>
            <Th>Service</Th>
            <Th className="hidden sm:table-cell">Trigger</Th>
            <Th>Pipeline</Th>
            <Th className="hidden md:table-cell">When</Th>
            <Th className="hidden lg:table-cell">Took</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const rs = runStatus(run.status)
            const sermon = run.sermon_id ? titleById.get(run.sermon_id) : null
            const steps = (Array.isArray(run.steps) ? run.steps : []) as PipelineStep[]
            const took = formatElapsed(run.started_at, run.finished_at)
            return (
              <Tr
                key={run.id}
                className="animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)] motion-reduce:animate-none"
              >
                <Td>
                  <Badge variant={rs.variant}>{rs.label}</Badge>
                </Td>
                <Td className="max-w-[40ch]">
                  {sermon ? (
                    <Link
                      href={`/sermons/${sermon.id}`}
                      prefetch
                      className="truncate font-medium text-ink underline-offset-2 hover:text-gold-dark hover:underline"
                    >
                      {sermon.title}
                    </Link>
                  ) : (
                    <span className="truncate text-ink-muted">{run.youtube_video_id}</span>
                  )}
                </Td>
                <Td className="hidden capitalize text-ink-muted sm:table-cell">{run.trigger}</Td>
                <Td>
                  <PipelineStepsCompact steps={steps} />
                </Td>
                <Td className="hidden whitespace-nowrap text-ink-muted md:table-cell">
                  {formatDistanceToNowStrict(new Date(run.started_at), { addSuffix: true })}
                </Td>
                <Td className="hidden whitespace-nowrap text-ink-faint lg:table-cell">
                  {took ?? (run.status === "running" ? "running…" : "—")}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </Table>
    </TableCard>
  )
}
