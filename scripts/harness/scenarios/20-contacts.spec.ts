import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("contacts list", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  await screenshotPage(authed, "contacts-list")
})

test("contact detail", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  await authed.locator("table tbody tr a").first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-detail")
})

test("new contact form", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts/new")
  await screenshotPage(authed, "contact-new")
})

test("edit contact", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  await authed.locator("table tbody tr a").first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  await authed.locator("a", { hasText: "Edit" }).click()
  await authed.waitForURL(/\/edit$/)
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-edit")
})
