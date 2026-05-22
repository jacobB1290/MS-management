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
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
