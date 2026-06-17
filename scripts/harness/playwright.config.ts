import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// HARNESS_PROJECTS — opt-in fast lane for local iteration.
//
// By default every run exercises all five viewport projects (the full matrix).
// During active development you can restrict to one or more projects to get a
// faster feedback loop:
//
//   HARNESS_PROJECTS=mobile-393 npm run harness
//   HARNESS_PROJECTS=mobile-393,desktop-1280 npm run harness
//
// Valid names: mobile-360 | mobile-393 | tablet-768 | desktop-1280 | desktop-1440
//
// This is an OPT-IN override — unset (or empty) means "all five", so CI and
// any unconditional `npm run harness` invocation always cover the full matrix.
// Never commit a workflow file that sets this variable; it is a dev shortcut
// only.
// ---------------------------------------------------------------------------
const HARNESS_PROJECTS_ENV = process.env.HARNESS_PROJECTS;
const projectFilter: Set<string> | null = HARNESS_PROJECTS_ENV
  ? new Set(HARNESS_PROJECTS_ENV.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

// All five canonical viewport definitions in one place. The filter below
// either passes the full list through or narrows it to whatever the env
// variable requested. Unknown names in the env var are silently dropped (you
// get an empty projects array, which Playwright will surface as "no tests").
const ALL_PROJECTS = [
  {
    name: "mobile-360",
    use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } },
  },
  {
    name: "mobile-393",
    use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 852 } },
  },
  {
    name: "tablet-768",
    use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
  },
  {
    name: "desktop-1280",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
  },
  {
    name: "desktop-1440",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  },
];

const activeProjects = projectFilter
  ? ALL_PROJECTS.filter((p) => projectFilter.has(p.name))
  : ALL_PROJECTS;

export default defineConfig({
  testDir: "./scenarios",
  outputDir: "../../test-results",
  snapshotPathTemplate:
    "{testDir}/../screenshots/baseline/{testFilePath}-{projectName}-{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // The metrics-reporter always runs alongside the human-readable reporter;
  // it appends one JSON line to scripts/harness/metrics/history.jsonl per run
  // so we can track duration/failure trends across commits without an external
  // service. It is wrapped in try/catch internally so a bug there can never
  // fail the suite.
  reporter: process.env.CI
    ? [["html"], ["./metrics-reporter.ts"]]
    : [["list"], ["./metrics-reporter.ts"]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    colorScheme: "light",
    contextOptions: {
      reducedMotion: "reduce",
    },
  },
  projects: activeProjects,
  webServer: {
    // Production build + serve (faster than dev-compiling under the first
    // test per route, and the screenshots match what ships). See serve.sh
    // for why it exec's the server — teardown must kill the real process so
    // no later run can reuse a stale build.
    command: "sh scripts/harness/serve.sh",
    cwd: "../..",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    // Boot the app on in-memory demo fixtures so the harness is hermetic — no
    // Supabase project, secrets, or seeded users. The NEXT_PUBLIC_* values are
    // placeholders: demo mode serves SSR'd fixtures, and they only need to be
    // present + well-formed so the browser Supabase client constructs (its
    // realtime socket never connects, which is fine for screenshots).
    //
    // HARNESS_SKIP_BUILD is forwarded explicitly because Playwright's webServer
    // `env` block can shadow the inherited shell environment on some platforms.
    // Forwarding it here means `HARNESS_SKIP_BUILD=1 npm run harness` works
    // regardless of how the host shell's env is inherited by the child process.
    env: {
      DEMO_MODE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "demo-anon-key",
      ...(process.env.HARNESS_SKIP_BUILD
        ? { HARNESS_SKIP_BUILD: process.env.HARNESS_SKIP_BUILD }
        : {}),
    },
  },
});
