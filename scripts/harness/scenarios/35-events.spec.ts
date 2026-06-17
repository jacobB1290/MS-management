import { test, expect } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("event detail collapse header (mobile)", async ({ authed }) => {
  test.skip((authed.viewportSize()?.width ?? 0) >= 768, "collapse header is mobile-only chrome")
  await gotoAndSettle(authed, "/events/E01")
  await authed.locator("[data-scroll-region]").evaluate((el) => { el.scrollTop = 200 })
  await authed.waitForTimeout(600)
  await expect(authed.locator("[data-collapse-bar]")).toHaveAttribute("data-scrolled", "true")
  await expect(authed.locator("[data-collapse-title]")).toHaveAttribute("data-collapsed", "true")
  await screenshotPage(authed, "event-detail-collapsed")
})

test("events list (upcoming + past)", async ({ authed }) => {
  await gotoAndSettle(authed, "/events")
  await screenshotPage(authed, "events-list")
})

test("event editor with live preview", async ({ authed }) => {
  await gotoAndSettle(authed, "/events/new")
  await screenshotPage(authed, "event-new")
})

test("event detail + edit", async ({ authed }) => {
  await gotoAndSettle(authed, "/events/E01")
  await screenshotPage(authed, "event-detail")
})

test("promote an event (pre-filled campaign)", async ({ authed }) => {
  await gotoAndSettle(authed, "/campaigns/new?event=E01")
  await screenshotPage(authed, "event-promote")
})
