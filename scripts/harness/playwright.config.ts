import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./scenarios",
  outputDir: "../../test-results",
  snapshotPathTemplate:
    "{testDir}/../screenshots/baseline/{testFilePath}-{projectName}-{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",
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
  projects: [
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
  ],
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
    env: {
      DEMO_MODE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://demo.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "demo-anon-key",
    },
  },
});
