#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// metrics-report.ts — print the cross-session performance & reliability ledger.
//
// Usage:
//   npx tsx scripts/harness/metrics-report.ts
//   npm run harness:metrics
//
// Reads scripts/harness/metrics/history.jsonl and prints the last ~15 runs as
// an aligned table:
//
//   DATE                  SHA      BRANCH          PROJECTS  DUR(s)  PASS  FAIL  FLAKY  SKIP  NOTES
//   2026-06-17 09:12:45   a1b2c3d  main            all       142.3   254   0     0      3     ↓12s vs prev full
//   2026-06-17 08:00:01   a1b2c3d  main            mobile-393  28.1   51  0     0      1     [partial]
//
// For FULL runs (projects="all"), the table shows Δ-duration and Δ-failures
// vs the previous full run. Partial (HARNESS_PROJECTS-filtered) runs are
// tagged "[partial]" so they are not compared against full ones.
//
// If the ledger doesn't exist yet, the script prints a friendly message.
// ---------------------------------------------------------------------------

import * as fs from "fs"
import * as path from "path"

const LEDGER_PATH = path.resolve(__dirname, "metrics", "history.jsonl")
const DISPLAY_ROWS = 15

interface LedgerEntry {
  ts: string
  sha: string
  branch: string
  durationMs: number
  projects: string
  total: number
  passed: number
  failed: number
  flaky: number
  skipped: number
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pad(s: string | number, width: number, right = false): string {
  const str = String(s)
  if (str.length >= width) return str.slice(0, width)
  const pad = " ".repeat(width - str.length)
  return right ? pad + str : str + pad
}

function fmtDate(iso: string): string {
  // "2026-06-17T09:12:45.123Z" → "2026-06-17 09:12:45"
  return iso.replace("T", " ").replace(/\.\d+Z?$/, "").replace("Z", "")
}

function fmtDur(ms: number): string {
  return (ms / 1000).toFixed(1)
}

function sign(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `${n}`
  return "±0"
}

function signMs(ms: number): string {
  const s = (ms / 1000).toFixed(1)
  if (ms > 0) return `+${s}s`
  if (ms < 0) return `${s}s`
  return "±0s"
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.log(`\nNo metrics ledger found at:\n  ${LEDGER_PATH}\n`)
    console.log("Run `npm run harness` once to seed the ledger.\n")
    return
  }

  const raw = fs.readFileSync(LEDGER_PATH, "utf8").trim()
  if (!raw) {
    console.log("Ledger is empty. Run `npm run harness` to seed it.\n")
    return
  }

  const all: LedgerEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) as LedgerEntry }
      catch { return null }
    })
    .filter((e): e is LedgerEntry => e !== null)

  if (all.length === 0) {
    console.log("Ledger contains no valid JSON lines.\n")
    return
  }

  // Show the last DISPLAY_ROWS entries, most-recent last (chronological order).
  const rows = all.slice(-DISPLAY_ROWS)

  // Pre-compute delta notes for full runs.
  // We walk forward through ALL entries, tracking the most-recent full run.
  const deltaNotes: Map<number, string> = new Map()
  let prevFull: LedgerEntry | null = null
  for (let i = 0; i < all.length; i++) {
    const e = all[i]
    const isFull = e.projects === "all"
    if (isFull && prevFull) {
      const durDelta = e.durationMs - prevFull.durationMs
      const failDelta = e.failed - prevFull.failed
      const parts: string[] = []
      parts.push(`${signMs(durDelta)} dur`)
      if (failDelta !== 0) parts.push(`${sign(failDelta)} fail`)
      deltaNotes.set(i, parts.join(", "))
    }
    if (isFull) prevFull = e
  }

  // Build note strings for the display window (map from row index in `rows`).
  // We need to recover their original indices into `all`.
  const startIdx = all.length - rows.length

  // Column widths.
  const C = {
    date:     20,
    sha:       8,
    branch:   16,
    projects: 12,
    dur:       8,
    pass:      6,
    fail:      5,
    flaky:     6,
    skip:      5,
    notes:    24,
  }

  // Header.
  const hr = [
    pad("DATE",     C.date),
    pad("SHA",      C.sha),
    pad("BRANCH",   C.branch),
    pad("PROJECTS", C.projects),
    pad("DUR(s)",   C.dur,  true),
    pad("PASS",     C.pass, true),
    pad("FAIL",     C.fail, true),
    pad("FLAKY",    C.flaky,true),
    pad("SKIP",     C.skip, true),
    "NOTES",
  ].join("  ")

  const divider = "-".repeat(hr.length)

  console.log("\nHarness run ledger — last " + rows.length + " of " + all.length + " total runs\n")
  console.log(divider)
  console.log(hr)
  console.log(divider)

  for (let r = 0; r < rows.length; r++) {
    const e = rows[r]
    const globalIdx = startIdx + r
    const isFull = e.projects === "all"
    const noteBase = deltaNotes.get(globalIdx) ?? ""
    const partial = isFull ? "" : "[partial]"
    const note = [noteBase, partial].filter(Boolean).join(" ")

    const line = [
      pad(fmtDate(e.ts),          C.date),
      pad(e.sha,                   C.sha),
      pad(e.branch || "(detached)",C.branch),
      pad(e.projects,              C.projects),
      pad(fmtDur(e.durationMs),   C.dur,  true),
      pad(e.passed,                C.pass, true),
      pad(e.failed,                C.fail, true),
      pad(e.flaky,                 C.flaky,true),
      pad(e.skipped,               C.skip, true),
      note,
    ].join("  ")

    console.log(line)
  }

  console.log(divider)

  // Summary stats for full runs.
  const fullRuns = all.filter((e) => e.projects === "all")
  if (fullRuns.length >= 2) {
    const avg = fullRuns.reduce((s, e) => s + e.durationMs, 0) / fullRuns.length
    const avgFail = fullRuns.reduce((s, e) => s + e.failed, 0) / fullRuns.length
    console.log(
      `\nFull runs: ${fullRuns.length}  |  avg duration: ${fmtDur(avg)}s  |  avg failures: ${avgFail.toFixed(1)}\n`,
    )
  } else {
    console.log()
  }
}

main()
