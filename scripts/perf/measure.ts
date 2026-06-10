/**
 * Real-environment performance measurement.
 *
 * Drives a real (deployed or local) build of the CRM with an authenticated
 * session and records, per route:
 *   - hard navigation: TTFB, FCP, LCP, total bytes of the HTML document
 *   - soft navigation (client-side router): time from click to the target
 *     page's content being on screen
 *
 * Each metric is sampled N times; the median is reported so a single network
 * blip doesn't skew the story. A warm-up pass absorbs serverless cold starts
 * (reported separately as "cold").
 *
 * Usage:
 *   tsx scripts/perf/login-state.ts <host>
 *   BASE_URL=https://ms-management.vercel.app tsx scripts/perf/measure.ts
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
const SAMPLES = Number(process.env.SAMPLES ?? 5)

const ROUTES: Array<{ path: string; label: string; ready: string }> = [
  { path: "/inbox", label: "Inbox (list)", ready: "main" },
  { path: "/contacts", label: "Contacts", ready: "main" },
  { path: "/campaigns", label: "Campaigns", ready: "main" },
  { path: "/events", label: "Events", ready: "main" },
  { path: "/settings", label: "Settings", ready: "main" },
  { path: "/audit", label: "Audit log", ready: "main" },
]

type HardSample = { ttfb: number; fcp: number; lcp: number; docBytes: number }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

async function hardLoad(page: Page, url: string, ready: string): Promise<HardSample> {
  await page.goto(url, { waitUntil: "load" })
  await page.waitForSelector(ready, { state: "visible", timeout: 30_000 })
  // Give LCP a beat to settle, then read the observers.
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
    const paints = performance.getEntriesByType("paint")
    const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime ?? -1
    let lcp = -1
    try {
      const entries = (window as unknown as { __lcp?: number }).__lcp
      if (entries) lcp = entries
    } catch {}
    return {
      ttfb: nav.responseStart - nav.requestStart,
      fcp,
      lcp,
      docBytes: nav.transferSize,
    }
  })
}

async function softNav(page: Page, fromPath: string, toPath: string, ready: string): Promise<number> {
  await page.goto(`${BASE_URL}${fromPath}`, { waitUntil: "load" })
  await page.waitForTimeout(300)
  const link = page.locator(`a[href="${toPath}"]`).first()
  const t0 = Date.now()
  await link.click()
  // "Content on screen": the destination's main region exists AND the route
  // changed. A loading skeleton counts — that's what the user perceives.
  await page.waitForURL(`**${toPath}**`, { timeout: 30_000 })
  await page.waitForSelector(ready, { state: "visible", timeout: 30_000 })
  return Date.now() - t0
}

async function newPage(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage()
  // Track LCP continuously so hardLoad can read the latest value.
  await page.addInitScript(() => {
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number }
        ;(window as unknown as { __lcp?: number }).__lcp = last.startTime
      }).observe({ type: "largest-contentful-paint", buffered: true })
    } catch {}
  })
  return page
}

async function main() {
  const stateFile = join(dirname(new URL(import.meta.url).pathname), ".auth-state.json")
  const storageState = JSON.parse(readFileSync(stateFile, "utf8"))

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    storageState,
    viewport: { width: 1440, height: 900 },
    // Sandboxed/proxied environments may re-sign TLS; the measurement is
    // about timing, not cert chains.
    ignoreHTTPSErrors: true,
  })
  const page = await newPage(ctx)

  console.log(`# Performance measurement — ${BASE_URL}`)
  console.log(`# ${SAMPLES} samples per metric, medians reported. ${new Date().toISOString()}\n`)

  // ---- Cold pass (first hit may be a cold serverless boot) ----
  const cold: Record<string, HardSample> = {}
  for (const r of ROUTES) {
    cold[r.path] = await hardLoad(page, `${BASE_URL}${r.path}`, r.ready)
  }

  // ---- Hard navigation, warm ----
  const hard: Record<string, HardSample[]> = {}
  for (let i = 0; i < SAMPLES; i++) {
    for (const r of ROUTES) {
      hard[r.path] ??= []
      hard[r.path].push(await hardLoad(page, `${BASE_URL}${r.path}`, r.ready))
    }
  }

  console.log("## Hard navigation (full page load, warm)\n")
  console.log("| Route | TTFB med | FCP med | LCP med | TTFB cold |")
  console.log("|---|---|---|---|---|")
  for (const r of ROUTES) {
    const s = hard[r.path]
    console.log(
      `| ${r.label} | ${median(s.map((x) => x.ttfb)).toFixed(0)}ms | ${median(s.map((x) => x.fcp)).toFixed(0)}ms | ${median(s.map((x) => x.lcp)).toFixed(0)}ms | ${cold[r.path].ttfb.toFixed(0)}ms |`,
    )
  }

  // ---- Soft navigation (client router) between sections ----
  console.log("\n## Soft navigation (sidebar click → content visible)\n")
  console.log("| From → To | median | min | max |")
  console.log("|---|---|---|---|")
  const pairs: Array<[string, string, string]> = [
    ["/inbox", "/contacts", "main"],
    ["/contacts", "/events", "main"],
    ["/events", "/campaigns", "main"],
    ["/campaigns", "/inbox", "main"],
    ["/inbox", "/settings", "main"],
  ]
  for (const [from, to, ready] of pairs) {
    const xs: number[] = []
    for (let i = 0; i < SAMPLES; i++) xs.push(await softNav(page, from, to, ready))
    console.log(
      `| ${from} → ${to} | ${median(xs).toFixed(0)}ms | ${Math.min(...xs)}ms | ${Math.max(...xs)}ms |`,
    )
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
