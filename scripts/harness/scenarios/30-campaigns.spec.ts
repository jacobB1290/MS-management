import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("campaigns list", async ({ authed }) => {
  await gotoAndSettle(authed, "/campaigns")
  await screenshotPage(authed, "campaigns-list")
})

test("campaign composer", async ({ authed }) => {
  await gotoAndSettle(authed, "/campaigns/new")
  await screenshotPage(authed, "campaign-composer")
})

test("campaign detail (sent)", async ({ authed }) => {
  await gotoAndSettle(authed, "/campaigns")
  // Open the "done" campaign (Easter weekend reminder, sorted to top by recency
  // or visible in the table).
  await authed.locator("table tbody tr a").first().click()
  await authed.waitForURL(/\/campaigns\/[\w-]+$/)
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "campaign-detail")
})
