import { test, expect } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("inbox list with conversations", async ({ authed }) => {
  await gotoAndSettle(authed, "/inbox")
  await expect(authed.getByRole("searchbox", { name: /search/i })).toBeVisible()
  await screenshotPage(authed, "inbox-list")
})

test("inbox with thread open", async ({ authed }) => {
  // Open the most recent conversation (Elena Volkov, seeded ~4h ago)
  await gotoAndSettle(authed, "/inbox")
  await authed.locator("ol li a").first().click()
  await authed.waitForURL(/\?c=/)
  await authed.waitForTimeout(400)
  await screenshotPage(authed, "inbox-thread")
})
