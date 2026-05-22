import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("settings page (admin)", async ({ authed }) => {
  await gotoAndSettle(authed, "/settings")
  await screenshotPage(authed, "settings")
})

test("audit log", async ({ authed }) => {
  await gotoAndSettle(authed, "/audit")
  await screenshotPage(authed, "audit-log")
})
