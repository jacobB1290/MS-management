"use client"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

type Segment = { key: string; label: string; count: number; bar: string; dot: string }

/**
 * One segmented "delivery funnel" bar (replaces the single gold progress bar):
 * proportional slices for delivered / in-flight / skipped / failed on semantic
 * tokens, so the skip-and-fail story the old bar couldn't show reads at a glance.
 * The slices build in left-to-right on mount (the page's one signature motion),
 * and the legend chips below double as the bar's key. Honors reduced motion.
 */
export function DeliveryFunnel({
  channel,
  delivered,
  inflight,
  skipped,
  failed,
  total,
}: {
  channel: "sms" | "email"
  delivered: number
  inflight: number
  skipped: number
  failed: number
  total: number
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(r)
  }, [])

  if (total === 0) return null

  const segments: Segment[] = (
    [
      {
        key: "delivered",
        label: channel === "sms" ? "sent" : "delivered",
        count: delivered,
        bar: "bg-success",
        dot: "bg-success",
      },
      { key: "inflight", label: "queued", count: inflight, bar: "bg-gold", dot: "bg-gold" },
      {
        key: "skipped",
        label: "skipped",
        count: skipped,
        bar: "bg-[color-mix(in_oklab,var(--ink)_16%,transparent)]",
        dot: "bg-[color-mix(in_oklab,var(--ink)_30%,transparent)]",
      },
      { key: "failed", label: "failed", count: failed, bar: "bg-danger", dot: "bg-danger" },
    ] as Segment[]
  ).filter((s) => s.count > 0)

  const aria = segments.map((s) => `${s.count} ${s.label}`).join(", ")

  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-pill bg-surface"
        role="img"
        aria-label={`Delivery: ${aria} of ${total}`}
      >
        {segments.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "h-full shrink-0 transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-out-soft)] motion-reduce:transition-none",
              s.bar,
            )}
            style={{
              width: mounted ? `${(s.count / total) * 100}%` : "0%",
              transitionDelay: `${i * 90}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {segments.map((s, i) => (
          <span
            key={s.key}
            className="inline-flex items-center gap-1.5 text-small text-ink-muted animate-[settings-pane-in_var(--motion-medium)_var(--ease-out-soft)_backwards] motion-reduce:animate-none"
            style={{ animationDelay: `${160 + i * 60}ms` }}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden />
            <span className="font-medium tabular-nums text-ink" data-dynamic>
              {s.count}
            </span>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
