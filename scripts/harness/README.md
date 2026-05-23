# Visual testing harness

Playwright-driven multi-viewport screenshot regression for the MS Management
operator UI. Visual verification beats type-checking for layout work, and we
test the matrix instead of one example viewport.

## Run

```
npm run harness
```

This boots `npm run dev` on port 3000 (reusing an existing dev server if you
already have one running), then runs every scenario across every viewport
project and compares against committed baselines. Any pixel drift above the
tolerance (`maxDiffPixelRatio: 0.005`) fails the run.

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

- `gotoAndSettle(page, path)` waits for network idle plus a 200ms tail for
  animations.
- `screenshotPage(page, name)` takes a full-page screenshot with the standard
  masks applied (date pills, relative timestamps, anything with
  `data-dynamic`).

If a new dynamic element creeps in, add the selector to `MASKS` in
`helpers.ts` rather than masking ad-hoc in every scenario.
