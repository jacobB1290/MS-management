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

test("inbox email channel toggle", async ({ authed }) => {
  // C05 (Jennifer Pace) has BOTH a phone and an email, so the composer shows
  // the Text / Email channel toggle. Default state is SMS.
  await gotoAndSettle(authed, "/inbox?c=C05")
  await authed.waitForTimeout(400)
  await expect(authed.getByRole("radio", { name: /email/i })).toBeVisible()
  await screenshotPage(authed, "inbox-channel-toggle")
})

test("inbox email composer", async ({ authed }) => {
  // Switch the channel toggle to Email and reveal the subject + body composer.
  await gotoAndSettle(authed, "/inbox?c=C05")
  await authed.waitForTimeout(400)
  await authed.getByRole("radio", { name: /email/i }).click()
  await authed.getByLabel("Email subject").fill("Re: Visiting this Sunday")
  await authed
    .getByPlaceholder("Write an email…")
    .fill(
      "Hi Jennifer, so glad you're planning to visit! We saved a few seats for your family at the 9am service. See you Sunday.",
    )
  await authed.waitForTimeout(200)
  await screenshotPage(authed, "inbox-email-composer")
})

test("new message dialog", async ({ authed }) => {
  // The compose flow for texting a number that isn't a contact yet.
  await gotoAndSettle(authed, "/inbox")
  await authed.getByRole("button", { name: /new message/i }).click()
  await authed.getByRole("heading", { name: /new message/i }).waitFor()
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "new-message-dialog")
})
