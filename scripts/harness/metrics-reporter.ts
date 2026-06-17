// ---------------------------------------------------------------------------
// metrics-reporter.ts — cross-session performance & reliability ledger.
//
// A Playwright Reporter that appends ONE JSON line to
// scripts/harness/metrics/history.jsonl at the end of every harness run.
// The ledger lets us track trends in run duration and test outcomes across
// commits without needing an external service.
//
// Registration: playwright.config.ts `reporter` array (alongside "list"/"html").
//
// Schema of each appended line:
//   {
//     ts:          ISO-8601 timestamp of this run's completion,
//     sha:         short git SHA (7 chars) of HEAD at run time,
//     branch:      current branch name (empty string if detached HEAD),
//     durationMs:  total wall-clock duration of the suite reported by Playwright,
//     projects:    value of HARNESS_PROJECTS env var, or "all" if unset,
//     total:       total test count,
//     passed:      number of passed tests,
//     failed:      number of failed tests,
//     flaky:       number of flaky tests (passed after retry),
//     skipped:     number of skipped / expected-failure tests,
//   }
//
// Failure safety: the ENTIRE reporter is wrapped in try/catch so a bug here
// can never fail the test suite. The ledger is informational, not load-bearing.
// ---------------------------------------------------------------------------

import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter"

/** Path to the append-only ledger file, relative to the repo root. */
const LEDGER_PATH = path.resolve(__dirname, "metrics", "history.jsonl")

/** One tally bucket per outcome. */
interface Tally {
  total: number
  passed: number
  failed: number
  flaky: number
  skipped: number
}

// ---------------------------------------------------------------------------
// MetricsReporter — implements Playwright's Reporter interface.
// ---------------------------------------------------------------------------
class MetricsReporter implements Reporter {
  private tally: Tally = {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
  }

  // Called once per test result (including retries). We tally outcomes here so
  // we don't have to re-walk the suite tree in onEnd.
  onTestEnd(_test: TestCase, result: TestResult): void {
    try {
      this.tally.total++
      switch (result.status) {
        case "passed":
          this.tally.passed++
          break
        case "failed":
        case "timedOut":
        case "interrupted":
          this.tally.failed++
          break
        case "skipped":
          this.tally.skipped++
          break
        // "flaky" is not a result.status value — Playwright marks a test
        // "passed" when it passes on a retry. We detect flakiness by checking
        // retryIndex > 0 AND status === "passed".
        default:
          break
      }
      // A test is flaky when it ultimately passed but needed at least one retry.
      if (result.status === "passed" && result.retry > 0) {
        this.tally.flaky++
        // It still counts as passed, so don't double-count — the passed++ above
        // is correct; flaky is an additional annotation, not a separate bucket.
      }
    } catch {
      // Never let tally errors surface as reporter errors.
    }
  }

  // Called once, after all tests finish.
  onEnd(result: FullResult): void | Promise<void> {
    try {
      // ── read git metadata ──────────────────────────────────────────────
      let sha = "unknown"
      let branch = ""
      try {
        sha = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
      } catch { /* git not available or not a repo — leave as "unknown" */ }
      try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
        // Detached HEAD → output is literally "HEAD"
        if (branch === "HEAD") branch = ""
      } catch { /* leave empty */ }

      // ── build the record ───────────────────────────────────────────────
      const record = {
        ts: new Date().toISOString(),
        sha,
        branch,
        durationMs: result.duration,
        projects: process.env.HARNESS_PROJECTS || "all",
        total: this.tally.total,
        passed: this.tally.passed,
        failed: this.tally.failed,
        flaky: this.tally.flaky,
        skipped: this.tally.skipped,
      }

      // ── ensure the directory exists and append ─────────────────────────
      const dir = path.dirname(LEDGER_PATH)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.appendFileSync(LEDGER_PATH, JSON.stringify(record) + "\n", "utf8")
    } catch {
      // Metrics failure must NEVER fail the suite — swallow everything.
    }
  }

  // Satisfy the interface — we don't need these hooks.
  onBegin(_config: FullConfig, _suite: Suite): void {}
}

export default MetricsReporter
