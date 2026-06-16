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
  // camp3 is a completed SMS blast with a full spread of outcomes (delivered,
  // sent, two carrier failures, no-consent, opted-out) — the rich recipient view.
  await gotoAndSettle(authed, "/campaigns/camp3")
  await authed.waitForTimeout(400)
  await screenshotPage(authed, "campaign-detail")
  // The full recipient list (the page lands on the most actionable bucket).
  await authed.getByRole("button", { name: /^all/i }).click()
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "campaign-detail-all")
})
