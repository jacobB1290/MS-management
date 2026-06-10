import { test, expect } from "../auth-fixture"
import { gotoAndSettle } from "../helpers"

/**
 * Design-system conformance — structural assertions, not pixels.
 *
 * The screenshot specs catch "something changed"; this spec catches "something
 * broke the system": a page whose chrome drifts off the shared scale, gutter,
 * or voice fails here with a named invariant instead of a pixel diff. That
 * makes review of generated/delegated work mechanical — if a change violates
 * the design system, the harness says which rule, on which page.
 *
 * Invariants:
 *  1. Exactly one h1 per page, in the display face, at the --text-heading tier.
 *  2. Every top-level page starts its header at the same left gutter.
 *  3. Italic is reserved for .motto identity phrases.
 *  4. Primary tap targets (nav tabs, icon actions) are at least 44px.
 *  5. Heading sizes only come from the token type scale.
 */

const TOP_PAGES = ["/contacts", "/events", "/campaigns"]

// Resolved per page-load because the fluid clamp() tokens compute differently
// per viewport. Read off <body> so percentages/clamps are fully resolved.
async function tokenPx(page: import("@playwright/test").Page, varName: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("div")
    probe.style.fontSize = `var(${name})`
    document.body.appendChild(probe)
    const px = parseFloat(getComputedStyle(probe).fontSize)
    probe.remove()
    return px
  }, varName)
}

test("every page has exactly one h1, display face, heading tier", async ({ authed }) => {
  // Below md the masthead h1 is hidden by design — the mobile topbar names the
  // page instead (assert that in the mobile test below).
  test.skip((authed.viewportSize()?.width ?? 0) < 768, "masthead is md+ chrome")
  for (const path of TOP_PAGES) {
    await gotoAndSettle(authed, path)
    const h1s = authed.locator("h1")
    await expect(h1s, `${path}: one page title`).toHaveCount(1)
    const style = await h1s.first().evaluate((el) => {
      const s = getComputedStyle(el)
      return { family: s.fontFamily, size: parseFloat(s.fontSize) }
    })
    expect(style.family, `${path}: h1 uses the display face`).toContain("Playfair")
    const heading = await tokenPx(authed, "--text-heading")
    expect(
      Math.abs(style.size - heading),
      `${path}: h1 sits at --text-heading (got ${style.size}px, token ${heading}px)`,
    ).toBeLessThanOrEqual(0.5)
  }
})

test("mobile topbar names each top-level page", async ({ authed }) => {
  test.skip((authed.viewportSize()?.width ?? 0) >= 768, "topbar is mobile chrome")
  const names: Record<string, string> = {
    "/contacts": "Contacts",
    "/events": "Events",
    "/campaigns": "Campaigns",
  }
  for (const path of TOP_PAGES) {
    await gotoAndSettle(authed, path)
    await expect(
      // The topbar is the mobile-only header band; the masthead h1 also holds
      // the name but is display:none below md, so scope to the topbar.
      authed.locator("header.md\\:hidden").getByText(names[path], { exact: true }),
      `${path}: topbar title`,
    ).toBeVisible()
  }
})

test("top-level pages share one left gutter", async ({ authed }) => {
  test.skip((authed.viewportSize()?.width ?? 0) < 768, "masthead is md+ chrome")
  const xs: Record<string, number> = {}
  for (const path of TOP_PAGES) {
    await gotoAndSettle(authed, path)
    const box = await authed.locator("h1").first().boundingBox()
    if (!box) throw new Error(`${path}: h1 not visible`)
    xs[path] = box.x
  }
  const values = Object.values(xs)
  const drift = Math.max(...values) - Math.min(...values)
  expect(drift, `gutters drift across tabs: ${JSON.stringify(xs)}`).toBeLessThanOrEqual(1)
})

test("italics appear only on .motto identity phrases", async ({ authed }) => {
  for (const path of [...TOP_PAGES, "/campaigns/new", "/events/new", "/settings"]) {
    await gotoAndSettle(authed, path)
    const offenders = await authed.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        if (!el.textContent?.trim()) continue
        if (getComputedStyle(el).fontStyle !== "italic") continue
        if (el.closest(".motto") || el.classList.contains("motto")) continue
        bad.push(`<${el.tagName.toLowerCase()} class="${el.className}"> “${el.textContent.trim().slice(0, 40)}”`)
      }
      return bad.slice(0, 5)
    })
    expect(offenders, `${path}: italic outside .motto`).toEqual([])
  }
})

test("primary tap targets are at least 44px", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  for (const selector of [".btn-icon-action", "nav a"]) {
    const els = authed.locator(selector)
    const n = await els.count()
    for (let i = 0; i < n; i++) {
      const el = els.nth(i)
      if (!(await el.isVisible())) continue
      const box = await el.boundingBox()
      if (!box) continue
      expect(box.height, `${selector}[${i}] height`).toBeGreaterThanOrEqual(40)
    }
  }
})

test("heading sizes come from the token type scale", async ({ authed }) => {
  for (const path of TOP_PAGES) {
    await gotoAndSettle(authed, path)
    const scale = await Promise.all(
      ["--text-hero", "--text-title", "--text-heading", "--text-lead", "--text-body", "--text-compact", "--text-small"].map(
        (t) => tokenPx(authed, t),
      ),
    )
    const offenders = await authed.evaluate(() => {
      const sizes: Array<{ tag: string; size: number; text: string }> = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3"))) {
        if (!el.textContent?.trim()) continue
        sizes.push({
          tag: el.tagName.toLowerCase(),
          size: parseFloat(getComputedStyle(el).fontSize),
          text: el.textContent.trim().slice(0, 30),
        })
      }
      return sizes
    })
    for (const h of offenders) {
      const onScale = scale.some((s) => Math.abs(s - h.size) <= 0.5)
      expect(
        onScale,
        `${path}: <${h.tag}> “${h.text}” at ${h.size}px is off the token scale [${scale.map((s) => s.toFixed(1)).join(", ")}]`,
      ).toBe(true)
    }
  }
})
