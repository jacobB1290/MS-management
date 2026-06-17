import { chromium } from "@playwright/test"
import { mkdir } from "fs/promises"

const BASE = "http://localhost:3001"
const OUT = "/tmp/collapse-shots"
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  reducedMotion: "no-preference",
  deviceScaleFactor: 2,
})
await ctx.addCookies([{ name: "ms_demo", value: "1", url: BASE, sameSite: "Lax" }])

const page = await ctx.newPage()
page.on("pageerror", (e) => console.error("PAGEERROR:", e.message))

async function captureStates(path, slug) {
  console.log(`\n--- ${slug} ---`)
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1000)

  const h1 = await page.locator("h1").first().textContent().catch(() => "<none>")
  console.log("h1:", h1?.trim())

  // 1. REST STATE
  const scrollRegion = page.locator("[data-scroll-region]")
  await scrollRegion.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${slug}-1-rest.png`, fullPage: false })
  console.log("✓ rest")

  // 2. MID STATE (title just starting to disappear under bar)
  await scrollRegion.evaluate((el) => { el.scrollTop = 60 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${slug}-2-mid.png`, fullPage: false })
  console.log("✓ mid")

  // 3. COLLAPSED STATE (title fully under bar)
  await scrollRegion.evaluate((el) => { el.scrollTop = 200 })
  await page.waitForTimeout(400)
  const barEl = page.locator("[data-collapse-bar]")
  const collapsed = await barEl.getAttribute("data-scrolled").catch(() => null)
  console.log("bar data-scrolled:", collapsed)
  const titleEl = page.locator("[data-collapse-title]")
  const titleCollapsed = await titleEl.getAttribute("data-collapsed").catch(() => null)
  console.log("title data-collapsed:", titleCollapsed)
  await page.screenshot({ path: `${OUT}/${slug}-3-collapsed.png`, fullPage: false })
  console.log("✓ collapsed")
}

await captureStates("/campaigns/camp3", "campaigns")
await captureStates("/events/E01", "events")
await captureStates("/contacts/C01", "contacts")

await browser.close()
console.log(`\nShots saved to ${OUT}/`)
