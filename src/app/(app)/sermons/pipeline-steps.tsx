import { cn } from "@/lib/utils"
import {
  STEP_ORDER,
  STEP_LABEL,
  formatElapsed,
  type PipelineStep,
  type StepName,
  type StepStatus,
} from "./types"

/**
 * The pipeline as a connected three-node track: Detect → Transcribe → Segment.
 * Each node is a dot colored by outcome (running pulses gold, succeeded is green,
 * failed is red, skipped/pending are quiet); the connector between two nodes
 * lights green only once the left one has succeeded, so the eye reads progress
 * left-to-right at a glance. This is the monitor's core "what happened" glyph,
 * used compact in the runs table and full (with labels + timing + errors) on the
 * sermon detail page.
 */

function resolve(steps: PipelineStep[], name: StepName): PipelineStep | null {
  // Last recorded entry for this step wins (a re-run can record it twice).
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].name === name) return steps[i]
  }
  return null
}

const DOT: Record<StepStatus, string> = {
  succeeded: "bg-success",
  running: "bg-gold",
  failed: "bg-danger",
  skipped: "bg-[color-mix(in_oklab,var(--ink)_22%,transparent)]",
  pending: "bg-transparent border border-ink-hairline",
}

function statusOf(step: PipelineStep | null): StepStatus {
  return step?.status ?? "pending"
}

/** Tiny inline track for a table cell. Title carries the full per-step summary. */
export function PipelineStepsCompact({ steps }: { steps: PipelineStep[] }) {
  const summary = STEP_ORDER.map((name) => {
    const s = resolve(steps, name)
    return `${STEP_LABEL[name]}: ${s?.status ?? "pending"}`
  }).join(" · ")

  return (
    <div className="flex items-center" title={summary} aria-label={summary}>
      {STEP_ORDER.map((name, i) => {
        const s = resolve(steps, name)
        const status = statusOf(s)
        const prevDone = i > 0 && statusOf(resolve(steps, STEP_ORDER[i - 1])) === "succeeded"
        return (
          <div key={name} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-5 transition-colors duration-[var(--motion-medium)]",
                  prevDone ? "bg-success/50" : "bg-ink-hairline",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 rounded-pill",
                DOT[status],
                status === "running" && "live-dot",
              )}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Full track with labels, timing, and inline error — for the detail run cards. */
export function PipelineStepsFull({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="flex flex-col sm:flex-row sm:items-start">
      {STEP_ORDER.map((name, i) => {
        const s = resolve(steps, name)
        const status = statusOf(s)
        const elapsed = s ? formatElapsed(s.startedAt, s.finishedAt) : null
        const last = i === STEP_ORDER.length - 1
        return (
          <li key={name} className="flex gap-3 sm:flex-1 sm:flex-col sm:gap-0">
            {/* Marker rail: dot + the connector to the next node. Vertical in the
                left gutter on mobile; the horizontal track on sm+. */}
            <div className="flex flex-col items-center sm:w-full sm:flex-row">
              <span
                aria-hidden
                className={cn(
                  "h-3 w-3 shrink-0 rounded-pill",
                  DOT[status],
                  status === "running" && "live-dot",
                )}
              />
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "my-1 h-6 w-px sm:my-0 sm:ml-2 sm:h-px sm:w-full",
                    "transition-colors duration-[var(--motion-medium)]",
                    status === "succeeded" ? "bg-success/45" : "bg-ink-hairline",
                  )}
                />
              )}
            </div>
            <div className="min-w-0 pb-4 sm:pb-0 sm:pr-4 sm:pt-2">
              <p className="text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint">
                {STEP_LABEL[name]}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-small font-medium capitalize",
                  status === "succeeded" && "text-success",
                  status === "failed" && "text-danger",
                  status === "running" && "text-gold-dark",
                  (status === "skipped" || status === "pending") && "text-ink-faint",
                )}
              >
                {status}
                {elapsed && (
                  <span className="ml-1.5 font-normal text-ink-faint">· {elapsed}</span>
                )}
              </p>
              {s?.detail && !s.error && (
                <p className="mt-0.5 text-micro leading-snug text-ink-muted">{s.detail}</p>
              )}
              {s?.error && (
                <p className="mt-0.5 break-words text-micro leading-snug text-danger/90">{s.error}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
