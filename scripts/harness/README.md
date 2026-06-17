# Visual testing harness

Playwright-driven multi-viewport screenshot regression for the MS Management
operator UI. Visual verification beats type-checking for layout work, and we
test the matrix instead of one example viewport.

## Run

```
npm run harness
```

This boots a production build on port 3000 (reusing an existing server if you
already have one running), then runs every scenario across every viewport
project and compares against committed baselines. Any pixel drift above the
tolerance (`maxDiffPixelRatio: 0.005`) fails the run.

## Speed-up env variables (OPT-IN, local only — never set in CI)

### `HARNESS_PROJECTS` — run a single viewport for fast iteration

```
HARNESS_PROJECTS=mobile-393 npm run harness
HARNESS_PROJECTS=mobile-393,desktop-1280 npm run harness
```

Valid names: `mobile-360` | `mobile-393` | `tablet-768` | `desktop-1280` |
`desktop-1440`. Unset (the default) runs all five. Use this while iterating
on a single breakpoint — it gives ~5× faster feedback. Always run the full
matrix before pushing.

### `HARNESS_SKIP_BUILD` — reuse an existing `.next` production build

```
HARNESS_SKIP_BUILD=1 npm run harness
```

Skips `next build` and boots the already-compiled `.next` directory. Safe to
use when you haven't changed any source files since the last successful build.
The hermetic DEMO_MODE boot is unaffected — only the build step is skipped.
**Do not use this if you've edited any `src/` files since the last build** —
screenshots will reflect the old compiled output and mislead you.

## Update baselines

```
npm run harness:update
```

Only run this **after** you've made an intentional visual change and you've
eyeballed the new screenshots. Commit the updated PNGs in the same PR as the
change that caused them. Never update baselines just to silence a failing CI.

Baselines live at `scripts/harness/screenshots/baseline/`. Diff and actual
output land under `scripts/harness/screenshots/{diff,actual}/` and are
gitignored.

## Viewport matrix

Every scenario runs against five viewport projects:

| Project        | Width x Height | Why                                     |
| -------------- | -------------- | --------------------------------------- |
| `mobile-360`   | 360 x 740      | Small Android floor                     |
| `mobile-393`   | 393 x 852      | iPhone 14 Pro reference                 |
| `tablet-768`   | 768 x 1024     | iPad portrait; layout transition zone   |
| `desktop-1280` | 1280 x 800     | Laptop floor                            |
| `desktop-1440` | 1440 x 900     | Common desktop                          |

The CRM ships two layouts (mobile single-focus, desktop master-detail). The
matrix exists so we catch the bug at the breakpoint we forgot, not just at
the one we designed against. Test the matrix, not the example.

All projects render with `prefers-reduced-motion: reduce` and
`colorScheme: light` so screenshots stay deterministic.

## Adding a scenario

One file per feature under `scripts/harness/scenarios/` named
`NN-feature.spec.ts` (`01-login.spec.ts`, `02-inbox.spec.ts`, ...). Keep them
short: navigate, settle, screenshot. Use the helpers in `helpers.ts`:

- `gotoAndSettle(page, path)` navigates to `path` (network idle), then waits
  for `document.fonts.ready`, one `requestAnimationFrame` flush, and an 80ms
  tail — so every screenshot starts from a deterministic, font-loaded state.
- `screenshotPage(page, name)` re-runs the same settle sequence immediately
  before the shot (cheap if already resolved) then takes a full-page
  screenshot with the standard masks applied (date pills, relative timestamps,
  anything with `data-dynamic`).

If a new dynamic element creeps in, add the selector to `MASKS` in
`helpers.ts` rather than masking ad-hoc in every scenario.

## Performance & reliability ledger

Every harness run appends one JSON line to
`scripts/harness/metrics/history.jsonl`. The ledger tracks duration, pass/fail
counts, and the git SHA across commits so you can spot regressions in run time
or reliability without an external service.

### View the ledger

```
npm run harness:metrics
```

Prints the last 15 runs as an aligned table. Full runs (all projects) show Δ
duration and Δ failures vs. the previous full run. Partial runs
(`HARNESS_PROJECTS`-filtered) are tagged `[partial]` so they are not compared
against full ones.

Example output:

```
DATE                  SHA      BRANCH           PROJECTS    DUR(s)  PASS  FAIL  FLAKY  SKIP  NOTES
2026-06-17 09:12:45   a1b2c3d  main             all         142.3    254     0      0     3
2026-06-17 08:00:01   a1b2c3d  main             mobile-393   28.1     51     0      0     1   [partial]
2026-06-17 07:45:00   9f8e7d6  feat/collapse    all         155.2    250     4      1     3   +12.9s dur, +4 fail
```

### Ledger schema

Each line is a JSON object:
```jsonc
{
  "ts":         "2026-06-17T09:12:45.123Z",   // ISO timestamp
  "sha":        "a1b2c3d",                     // git rev-parse --short HEAD
  "branch":     "main",                        // current branch
  "durationMs": 142300,                        // total suite wall-clock ms
  "projects":   "all",                         // HARNESS_PROJECTS or "all"
  "total":      257,
  "passed":     254,
  "failed":     0,
  "flaky":      0,
  "skipped":    3
}
```

The ledger file is committed (`baseline/` style) so trend data survives across
developer machines. The reporter is wrapped in try/catch — a ledger write
failure can never fail the suite.

## Design-system conformance (`50-conformance.spec.ts`)

Screenshots catch "something changed"; the conformance spec catches
"something broke the system" — and names the rule it broke. It asserts the
CLAUDE.md §7.1 invariants structurally:

- exactly one `h1` per page, display face, at the `--text-heading` tier;
- every top-level tab starts its header at the same left gutter (≤1px drift);
- italics appear only inside `.motto`;
- primary tap targets are ≥44px;
- every `h1/h2/h3` font-size is a member of the token type scale.

These assertions are the quality gate for delegated or generated work: a
change that drifts off the system fails with a named invariant instead of a
pixel diff someone might be tempted to re-baseline away. When a new
system-level rule lands in CLAUDE.md §7.1, add its assertion here in the same
PR — the harness should always be able to say "no" on the system's behalf.
