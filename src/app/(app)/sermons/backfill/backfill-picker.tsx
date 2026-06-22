"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, ListPlus, UploadCloud } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { eventDisplayDate } from "@/lib/event-format"
import { SermonThumb } from "../sermon-thumb"
import {
  BACKFILL_STATE,
  type BackfillCandidate,
  type BackfillListing,
  type BackfillState,
} from "../types"

/**
 * The "Process past services" picker. Staff multi-select past service videos and
 * queue them; a pg_cron worker drains the queue server-side (no CRM instance
 * needed), so this view's job is selection + live progress + the final bulk
 * publish. It polls while anything is in flight so progress animates in without
 * a manual refresh. Two action modes share one selection model: in the
 * processing filters the bar queues; in "Ready to review" it bulk-publishes.
 */

type Filter = "todo" | "inflight" | "review" | "published" | "all"

const FILTERS: { key: Filter; label: string; states: BackfillState[] | null }[] = [
  { key: "todo", label: "To process", states: ["new", "failed", "skipped"] },
  { key: "inflight", label: "In progress", states: ["queued", "processing", "in_progress"] },
  { key: "review", label: "Ready to review", states: ["review"] },
  { key: "published", label: "Published", states: ["published"] },
  { key: "all", label: "All", states: null },
]

const QUEUEABLE: BackfillState[] = ["new", "failed", "skipped"]

function isInFlight(c: BackfillCandidate): boolean {
  return c.state === "queued" || c.state === "processing" || c.state === "in_progress"
}

export function BackfillPicker({
  initial,
  captionsReady,
  aiReady,
}: {
  initial: BackfillListing
  captionsReady: boolean
  aiReady: boolean
}) {
  const router = useRouter()
  const [listing, setListing] = useState<BackfillListing>(initial)
  const [filter, setFilter] = useState<Filter>("todo")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<null | "queue" | "publish">(null)
  const [refreshing, setRefreshing] = useState(false)

  const candidates = listing.candidates
  const byVideo = useMemo(
    () => new Map(candidates.map((c) => [c.videoId, c])),
    [candidates],
  )

  // Live counts across every state (drives the summary band + filter availability).
  const tally = useMemo(() => {
    const t: Record<BackfillState, number> = {
      new: 0, queued: 0, processing: 0, review: 0,
      published: 0, in_progress: 0, failed: 0, skipped: 0,
    }
    for (const c of candidates) t[c.state]++
    return t
  }, [candidates])

  const anyInFlight = useMemo(() => candidates.some(isInFlight), [candidates])

  const barMode: "queue" | "publish" = filter === "review" ? "publish" : "queue"
  const canAct = useCallback(
    (c: BackfillCandidate) =>
      barMode === "publish" ? c.state === "review" : QUEUEABLE.includes(c.state),
    [barMode],
  )

  const visible = useMemo(() => {
    const def = FILTERS.find((f) => f.key === filter)!
    const list = def.states
      ? candidates.filter((c) => def.states!.includes(c.state))
      : candidates
    // Newest first; null dates sink.
    return [...list].sort((a, b) =>
      (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    )
  }, [candidates, filter])

  const actionable = useMemo(() => visible.filter(canAct), [visible, canAct])
  // Only selections that are actionable in the current bar mode count toward the
  // action — so a selection that finishes processing (and leaves the queueable
  // set) silently drops out of the count without a reconciliation effect.
  const selectedActionable = useMemo(
    () => [...selected].filter((id) => {
      const c = byVideo.get(id)
      return c ? canAct(c) : false
    }),
    [selected, byVideo, canAct],
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/sermons/backfill", { cache: "no-store" })
      if (res.ok) setListing((await res.json()) as BackfillListing)
    } catch {
      /* transient; the next tick retries */
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Poll while work is in flight so processing → review transitions animate in.
  // `refresh` is stable (useCallback []), so the interval only re-arms when the
  // in-flight state flips, never on every render.
  useEffect(() => {
    if (!anyInFlight) return
    const id = setInterval(() => {
      if (!document.hidden) refresh()
    }, 6000)
    return () => clearInterval(id)
  }, [anyInFlight, refresh])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    const ids = actionable.map((c) => c.videoId)
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  async function queueSelected() {
    const videos = selectedActionable
      .map((id) => byVideo.get(id))
      .filter((c): c is BackfillCandidate => Boolean(c))
      .map((c) => ({ videoId: c.videoId, title: c.title, publishedAt: c.publishedAt }))
    if (videos.length === 0) return
    setBusy("queue")
    try {
      const res = await fetch("/api/sermons/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error("Couldn’t queue those services. Try again.")
        return
      }
      const enq = json?.enqueued ?? 0
      const skip = json?.skipped ?? 0
      toast.success(
        enq > 0
          ? `Queued ${enq} service${enq === 1 ? "" : "s"}${skip ? ` · ${skip} already in progress` : ""}. Processing runs in the background.`
          : "Those services are already queued or processed.",
      )
      setSelected(new Set())
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  async function publishSelected() {
    const ids = selectedActionable
      .map((id) => byVideo.get(id)?.sermonId)
      .filter((x): x is string => Boolean(x))
    if (ids.length === 0) return
    setBusy("publish")
    try {
      const res = await fetch("/api/sermons/bulk-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error("Couldn’t publish those sermons. Try again.")
        return
      }
      const pub = json?.published?.length ?? 0
      const failed = json?.failed?.length ?? 0
      toast.success(
        `Published ${pub} to ms.church${failed ? ` · ${failed} couldn’t publish` : ""}.`,
      )
      setSelected(new Set())
      await refresh()
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const ready = captionsReady && aiReady
  const selCount = selectedActionable.length
  const allVisibleSelected =
    actionable.length > 0 && actionable.every((c) => selected.has(c.videoId))

  return (
    <div className="pb-28">
      {/* Summary band */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-hairline bg-ink-hairline sm:grid-cols-4">
        <Stat label="Past services" value={tally.new + tally.queued + tally.processing + tally.in_progress + tally.review + tally.published + tally.failed + tally.skipped} />
        <Stat label="To process" value={tally.new + tally.failed + tally.skipped} accent={tally.new > 0 ? "gold" : undefined} />
        <Stat
          label="In progress"
          value={tally.queued + tally.processing + tally.in_progress}
          live={anyInFlight}
        />
        <Stat label="Published" value={tally.published} accent={tally.published > 0 ? "success" : undefined} />
      </div>

      {!ready && (
        <p className="mt-4 rounded-xl border border-ink-hairline bg-surface/60 px-4 py-3 text-small text-ink-muted">
          {!captionsReady && !aiReady
            ? "Heads up: YouTube captions and AI segmentation aren’t connected yet, so queued services will wait until both are set up."
            : !captionsReady
              ? "Heads up: YouTube captions aren’t connected, so queued services will wait until transcription is set up."
              : "Heads up: AI segmentation is off (no Anthropic key), so queued services will transcribe but won’t chapter until it’s set up."}
        </p>
      )}

      {/* Filters */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1">
          {FILTERS.map((f) => {
            const count =
              f.states === null
                ? candidates.length
                : f.states.reduce((n, s) => n + tally[s], 0)
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                className={cn(
                  "shrink-0 rounded-pill px-3 py-1.5 text-small font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
                  active
                    ? "bg-ink text-white"
                    : "text-ink-muted hover:bg-surface hover:text-ink",
                )}
              >
                {f.label}
                <span className={cn("ml-1.5 tabular-nums", active ? "text-white/70" : "text-ink-faint")}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        {refreshing && (
          <Loader2 size={15} className="shrink-0 animate-spin text-ink-faint" aria-label="Refreshing" />
        )}
      </div>

      {/* Select-all row */}
      {actionable.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={selectAllVisible}
            className="text-small font-medium text-gold transition-colors hover:text-gold-dark"
          >
            {allVisibleSelected ? "Clear selection" : `Select all ${actionable.length}`}
          </button>
          <span className="text-micro text-ink-faint">
            {barMode === "publish" ? "Tap to choose what goes live" : "Tap to choose what to process"}
          </span>
        </div>
      )}

      {/* List */}
      {visible.length === 0 ? (
        <p className="mt-10 text-center text-body text-ink-faint">
          Nothing here right now.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visible.map((c) => (
            <Row
              key={c.videoId}
              c={c}
              selectable={canAct(c)}
              selected={selected.has(c.videoId)}
              onToggle={() => toggle(c.videoId)}
            />
          ))}
        </ul>
      )}

      {/* Sticky action bar */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-ink-hairline bg-white/90 backdrop-blur-md transition-transform duration-[var(--motion-medium)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
          selCount > 0 ? "translate-y-0" : "translate-y-full",
        )}
        aria-hidden={selCount === 0}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-small font-medium text-ink">
            {selCount} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={busy !== null}
            >
              Clear
            </Button>
            {barMode === "publish" ? (
              <Button size="sm" onClick={publishSelected} disabled={busy !== null || selCount === 0}>
                {busy === "publish" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <UploadCloud size={15} />
                )}
                <span>{busy === "publish" ? "Publishing…" : `Publish ${selCount}`}</span>
              </Button>
            ) : (
              <Button size="sm" onClick={queueSelected} disabled={busy !== null || selCount === 0}>
                {busy === "queue" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ListPlus size={15} />
                )}
                <span>{busy === "queue" ? "Queuing…" : `Queue ${selCount}`}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------- */

function Stat({
  label,
  value,
  accent,
  live,
}: {
  label: string
  value: number
  accent?: "gold" | "success"
  live?: boolean
}) {
  const color =
    accent === "gold" ? "text-gold-dark" : accent === "success" ? "text-success" : "text-ink"
  return (
    <div className="flex flex-col gap-0.5 bg-white px-4 py-3.5">
      <span className="text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
        {label}
      </span>
      <span className="flex items-center gap-2">
        <span className={cn("font-display text-lead tabular-nums", color)}>{value}</span>
        {live && value > 0 && (
          <span aria-hidden className="live-dot h-2 w-2 rounded-pill bg-gold" />
        )}
      </span>
    </div>
  )
}

function Row({
  c,
  selectable,
  selected,
  onToggle,
}: {
  c: BackfillCandidate
  selectable: boolean
  selected: boolean
  onToggle: () => void
}) {
  const state = BACKFILL_STATE[c.state]
  const date = c.publishedAt ? eventDisplayDate(c.publishedAt) : "Date unknown"
  const inner = (
    <>
      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-surface sm:w-28">
        <SermonThumb videoId={c.videoId} alt={c.title} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-small font-medium text-ink">{c.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant={state.variant}>{state.label}</Badge>
          <span className="text-micro text-ink-faint">{date}</span>
          {c.state === "failed" && c.queueError && (
            <span className="text-micro text-danger">· {c.queueError.replace(/_/g, " ")}</span>
          )}
        </span>
      </span>
      {selectable && (
        <span
          aria-hidden
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-pill border transition-all duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
            selected
              ? "border-gold bg-gold text-white scale-100"
              : "border-ink-hairline bg-white text-transparent",
          )}
        >
          <Check size={14} className={cn("transition-transform", selected ? "scale-100" : "scale-0")} />
        </span>
      )}
    </>
  )

  if (!selectable) {
    return (
      <li className="flex items-center gap-3 rounded-xl border border-ink-hairline bg-white p-2.5 sm:gap-4 sm:p-3 animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)] motion-reduce:animate-none">
        {inner}
      </li>
    )
  }
  return (
    <li className="animate-[fade-in_var(--motion-medium)_var(--ease-out-soft)] motion-reduce:animate-none">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-white p-2.5 text-left transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out-soft)] motion-reduce:transition-none sm:gap-4 sm:p-3",
          selected
            ? "border-gold bg-[color-mix(in_oklab,var(--gold)_6%,white)]"
            : "border-ink-hairline hover:bg-surface",
        )}
      >
        {inner}
      </button>
    </li>
  )
}
