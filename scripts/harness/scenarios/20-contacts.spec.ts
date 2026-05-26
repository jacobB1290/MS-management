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

test("delete contact dialog", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  await authed.locator("table tbody tr a").first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  // The delete affordance lives in the admin-only Danger zone at the foot of
  // the (internally scrolling) detail pane; clicking auto-scrolls it in.
  await authed.getByRole("button", { name: /delete contact/i }).click()
  await authed.getByText(/type delete to confirm/i).waitFor()
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-delete-dialog")
})
