"use client"
import { useMemo, useState } from "react"
import Link from "next/link"
import { Search, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { TableCard, Table, Th, Tr, Td } from "@/components/ui/table"
import type { OutcomeGroup, OutcomeVariant } from "@/lib/campaign-recipient-status"

export type RecipientRow = {
  contactId: string
  name: string
  handle: string
  /** Specific badge label (e.g. the exact carrier error). */
  label: string
  /** Coarser filter-chip identity (all failures collapse to one "Failed" chip). */
  chip: string
  detail: string
  variant: OutcomeVariant
  group: OutcomeGroup
  when: string | null
  href: string
}

// Attention-first: failures, then fixable skips, then in-flight, then the wins.
const GROUP_RANK: Record<OutcomeGroup, number> = { failed: 0, skipped: 1, inflight: 2, delivered: 3 }

/**
 * The campaign's recipients as people-with-outcomes — the answer to "who was
 * skipped, and why". Outcome filter chips (defaulting to the most actionable
 * non-empty bucket) + name/number search drive one shared, filtered set that
 * renders two ways: a real Table on desktop, single-focus stacked cards on
 * mobile. Rows arrive pre-sorted attention-first from the server.
 */
export function RecipientTable({
  rows,
  loadedOf,
}: {
  rows: RecipientRow[]
  /** When the campaign exceeds the fetch cap, the true total (for an honest footer). */
  loadedOf?: number | null
}) {
  const chips = useMemo(() => {
    const byChip = new Map<string, { label: string; group: OutcomeGroup; count: number }>()
    for (const r of rows) {
      const c = byChip.get(r.chip)
      if (c) c.count += 1
      else byChip.set(r.chip, { label: r.chip, group: r.group, count: 1 })
    }
    return [...byChip.values()].sort(
      (a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || b.count - a.count,
    )
  }, [rows])

  // Land already looking at what needs a human: the first attention chip
  // (failed / skipped / in-flight); fall back to everything for a clean send.
  const firstActionable = chips.find((c) => c.group !== "delivered")
  const [active, setActive] = useState<string>(firstActionable?.label ?? "all")
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const digits = q.replace(/\D/g, "")
    return rows.filter((r) => {
      if (active !== "all" && r.chip !== active) return false
      if (!q) return true
      if (r.name.toLowerCase().includes(q)) return true
      if (r.handle.toLowerCase().includes(q)) return true
      return Boolean(digits) && r.handle.replace(/\D/g, "").includes(digits)
    })
  }, [rows, active, query])

  return (
    <div>
      {/* Controls: outcome chips (h-scroll on mobile) + search */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          <Chip active={active === "all"} onClick={() => setActive("all")} label="All" count={rows.length} />
          {chips.map((c) => (
            <Chip
              key={c.label}
              active={active === c.label}
              onClick={() => setActive(c.label)}
              label={c.label}
              count={c.count}
              tone={c.group}
            />
          ))}
        </div>
        <label className="relative shrink-0 lg:w-60">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipients"
            aria-label="Search recipients"
            className="h-9 w-full rounded-pill border border-ink-hairline bg-surface pl-9 pr-3 text-small text-ink placeholder:text-ink-faint transition-colors duration-[var(--motion-fast)] focus:border-gold focus:outline-none"
          />
        </label>
      </div>

      {/* DESKTOP — a real table */}
      <TableCard className="hidden md:block">
        <Table>
          <thead>
            <tr className="border-b border-ink-hairline">
              <Th>Recipient</Th>
              <Th>Outcome</Th>
              <Th>Reason</Th>
              <Th className="text-right">When</Th>
              <Th className="w-8" aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <Tr key={r.contactId} className="group align-top">
                <Td className="w-[13rem]">
                  <Link href={r.href} prefetch={false} className="block min-w-0">
                    <span className="block truncate text-ink group-hover:text-gold-dark">{r.name}</span>
                    {r.handle !== r.name && (
                      <span className="block truncate text-micro text-ink-faint">{r.handle}</span>
                    )}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">
                  <Badge variant={r.variant}>{r.label}</Badge>
                </Td>
                <Td className="text-small text-ink-muted">
                  <span className="line-clamp-2">{r.detail}</span>
                </Td>
                <Td className="whitespace-nowrap text-right text-small text-ink-faint" data-dynamic>
                  {r.when ?? "—"}
                </Td>
                <Td className="text-right">
                  <Link href={r.href} prefetch={false} aria-label={`Open ${r.name}`} className="inline-flex">
                    <ChevronRight
                      size={16}
                      className="text-ink-faint transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 group-hover:text-ink-muted"
                    />
                  </Link>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {filtered.length === 0 && <NoMatch />}
      </TableCard>

      {/* MOBILE — single-focus stacked cards, whole card tappable */}
      <ul className="overflow-hidden rounded-lg border border-ink-hairline bg-white md:hidden">
        {filtered.map((r) => (
          <li key={r.contactId} className="border-b border-ink-hairline last:border-b-0">
            <Link
              href={r.href}
              prefetch={false}
              className="flex items-start gap-3 px-4 py-3 transition-colors active:bg-surface"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-body text-ink">{r.name}</span>
                  <Badge variant={r.variant}>{r.label}</Badge>
                </div>
                {r.handle !== r.name && (
                  <p className="mt-0.5 truncate text-small text-ink-faint">{r.handle}</p>
                )}
                <p className="mt-1 text-small leading-[var(--leading-prose)] text-ink-muted">{r.detail}</p>
                {r.when && (
                  <p className="mt-1 text-micro text-ink-faint" data-dynamic>
                    {r.when}
                  </p>
                )}
              </div>
              <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          </li>
        ))}
        {filtered.length === 0 && <NoMatch />}
      </ul>

      <p className="mt-3 text-small text-ink-muted" data-dynamic>
        {filtered.length} {filtered.length === 1 ? "recipient" : "recipients"}
        {active === "all" ? "" : ` · ${active.toLowerCase()}`}
        {loadedOf ? ` · showing first ${rows.length} of ${loadedOf}` : ""}
      </p>
    </div>
  )
}

function Chip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  tone?: OutcomeGroup
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-small font-medium transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
        active
          ? "border-gold bg-[color-mix(in_oklab,var(--gold)_12%,transparent)] text-gold-dark"
          : "border-ink-hairline text-ink-muted hover:border-ink-faint hover:text-ink",
      )}
    >
      {label}
      <span
        className={cn(
          "tabular-nums text-micro",
          active ? "text-gold-dark/80" : tone === "failed" ? "text-danger" : "text-ink-faint",
        )}
      >
        {count}
      </span>
    </button>
  )
}

function NoMatch() {
  return <p className="px-4 py-10 text-center text-small text-ink-faint">No recipients match.</p>
}
