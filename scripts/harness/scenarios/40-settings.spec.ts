import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("settings page (admin)", async ({ authed }) => {
  // Default view: the macOS-style rail + first pane (desktop), or the iOS
  // grouped category list (mobile/tablet, below lg).
  await gotoAndSettle(authed, "/settings")
  await screenshotPage(authed, "settings")
})

test("settings pane — system", async ({ authed }) => {
  // Exercises the rail: selecting a row swaps the pane on desktop and drills
  // into it on mobile. System has the provider-config card, so it also guards
  // that pane's layout.
  await gotoAndSettle(authed, "/settings")
  await authed.getByRole("button", { name: "System" }).click()
  await authed.waitForTimeout(250)
  await screenshotPage(authed, "settings-system")
})

test("audit log", async ({ authed }) => {
  await gotoAndSettle(authed, "/audit")
  await screenshotPage(authed, "audit-log")
})
