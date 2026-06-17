import { test, expect, type Page } from "../auth-fixture"
import { gotoAndSettle } from "../helpers"

/**
 * Structural conformance for the iOS collapsing header (CLAUDE.md §7.1).
 *
 * Scope, deliberately: the harness runs with prefers-reduced-motion, and the
 * *scroll* collapse depends on demo content being tall enough to scroll (not
 * guaranteed per page) — so the scroll animation and its feel are owned by the
 * independent motion review, and per-page screenshots are owned by the feature
 * specs (20-contacts, 35-events, …). This spec asserts the things that must hold
 * regardless of content height or motion:
 *
 *  - Mobile (<md): every subview renders a [data-collapsing-header] that is
 *    collapsed=false at rest, with the inline bar title + frosted scrim hidden
 *    (opacity ~0) — i.e. the large hero, not the slim bar, shows on arrival.
 *  - Desktop (≥md): that subtree is display:none (it is md:hidden chrome) and the
 *    page shows exactly one visible <h1> — the static centered PageHeader.
 *  - Mobile list tabs: the Topbar carries data-scrolled and names the page at
 *    rest (large title present), matching the conformance topbar invariant.
 */

async function collapsingHeaderPresent(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector("[data-collapsing-header]"))
}

async function computedOpacity(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)
    return el ? parseFloat(getComputedStyle(el).opacity) : NaN
  }, selector)
}

// Subviews that always render in DEMO_MODE without seeded data (no events/etc.).
const SUBVIEW_PAGES = [
  { label: "audit log", path: "/audit" },
  { label: "settings", path: "/settings" },
]

const LIST_PAGES = [
  { label: "Contacts", path: "/contacts", title: "Contacts" },
  { label: "Events", path: "/events", title: "Events" },
  { label: "Campaigns", path: "/campaigns", title: "Campaigns" },
  { label: "Inbox", path: "/inbox", title: "Inbox" },
]

test.describe("collapsing header — mobile, at rest", () => {
  test.beforeEach(({ authed }) => {
    test.skip(
      (authed.viewportSize()?.width ?? 0) >= 768,
      "collapsing header is mobile (<768px) chrome; desktop shows the static PageHeader",
    )
  })

  for (const { label, path } of SUBVIEW_PAGES) {
    test(`${label}: collapsing header present; rest = collapsed, bar hidden`, async ({ authed }) => {
      await gotoAndSettle(authed, path)

      expect(
        await collapsingHeaderPresent(authed),
        `${path}: a [data-collapsing-header] should render on mobile`,
      ).toBe(true)

      await expect(
        authed.locator("[data-collapsing-header]").first(),
        `${path}: at rest, data-collapsed="false"`,
      ).toHaveAttribute("data-collapsed", "false")

      const inline = await computedOpacity(authed, ".collapse-inline-title")
      expect(inline, `${path}: inline bar title hidden at rest (opacity ${inline})`).toBeLessThanOrEqual(0.1)

      const scrim = await computedOpacity(authed, ".collapse-bar__scrim")
      expect(scrim, `${path}: frosted scrim hidden at rest (opacity ${scrim})`).toBeLessThanOrEqual(0.1)
    })
  }
})

test.describe("collapsing header — desktop is unaffected", () => {
  test.beforeEach(({ authed }) => {
    test.skip((authed.viewportSize()?.width ?? 0) < 768, "desktop-only assertion")
  })

  for (const { label, path } of SUBVIEW_PAGES) {
    test(`${label}: collapsing header is display:none; exactly one visible h1`, async ({ authed }) => {
      await gotoAndSettle(authed, path)

      const display = await authed.evaluate(() => {
        const el = document.querySelector<HTMLElement>("[data-collapsing-header]")
        return el ? getComputedStyle(el).display : "not-present"
      })
      expect(
        display === "none" || display === "not-present",
        `${path}: [data-collapsing-header] must be display:none on desktop (got "${display}")`,
      ).toBe(true)

      const visibleH1 = await authed.evaluate(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>("h1")).filter((el) => {
            const s = getComputedStyle(el)
            return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
          }).length,
      )
      expect(visibleH1, `${path}: desktop shows exactly one visible <h1> (got ${visibleH1})`).toBe(1)
    })
  }
})

test.describe("topbar — mobile list tabs name the page at rest", () => {
  test.beforeEach(({ authed }) => {
    test.skip((authed.viewportSize()?.width ?? 0) >= 768, "topbar is mobile chrome")
  })

  for (const { label, path, title } of LIST_PAGES) {
    test(`${label}: topbar present, data-scrolled=false, names the page`, async ({ authed }) => {
      await gotoAndSettle(authed, path)
      const topbar = authed.locator("header[data-scrolled]").first()
      await expect(topbar, `${path}: topbar carries data-scrolled`).toHaveAttribute("data-scrolled", "false")
      await expect(
        topbar.getByText(title, { exact: true }),
        `${path}: topbar names the page ("${title}")`,
      ).toBeVisible()
    })
  }
})
