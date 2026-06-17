import { test, expect } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("contacts list", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  await screenshotPage(authed, "contacts-list")
})

test("contact detail", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  // Directory rows are iOS-style Link rows, not a table.
  await authed.locator('a[href^="/contacts/"]:not([href$="/new"])').first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-detail")
})

test("contact detail greyed quick actions", async ({ authed }) => {
  // C02 is phone-only (no email, no name → titled by its number, like the iOS
  // contact card in the request). The Email quick action greys out to a
  // non-interactive state while Message stays a live link to the text thread.
  // (Call only renders when voice is configured — off in demo mode.)
  await gotoAndSettle(authed, "/contacts/C02")
  await authed.waitForTimeout(300)
  await expect(authed.getByRole("link", { name: "Message" })).toBeVisible()
  await expect(authed.getByRole("link", { name: "Email" })).toHaveCount(0)
  await screenshotPage(authed, "contact-detail-greyed")
})

test("new contact form", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts/new")
  await screenshotPage(authed, "contact-new")
})

test("edit contact", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  // Directory rows are iOS-style Link rows, not a table.
  await authed.locator('a[href^="/contacts/"]:not([href$="/new"])').first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  // The contact card renders quick actions in both layouts (desktop band +
  // mobile collapsing hero, one hidden per breakpoint), so scope to the visible
  // "Edit" to avoid a strict-mode match on the off-breakpoint copy.
  await authed.locator("a", { hasText: "Edit" }).filter({ visible: true }).first().click()
  await authed.waitForURL(/\/edit$/)
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-edit")
})

test("delete contact dialog", async ({ authed }) => {
  await gotoAndSettle(authed, "/contacts")
  // Directory rows are iOS-style Link rows, not a table.
  await authed.locator('a[href^="/contacts/"]:not([href$="/new"])').first().click()
  await authed.waitForURL(/\/contacts\/[\w-]+$/)
  // The delete affordance lives in the admin-only Danger zone at the foot of
  // the (internally scrolling) detail pane; clicking auto-scrolls it in.
  await authed.getByRole("button", { name: /delete contact/i }).click()
  await authed.getByText(/type delete to confirm/i).waitFor()
  // The click auto-scrolls the danger zone in behind the dialog and the final
  // offset can race the shot — pin every scrollable pane to its end so the
  // background is deterministic.
  await authed.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("div"))) {
      if (el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight
    }
  })
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "contact-delete-dialog")
})
