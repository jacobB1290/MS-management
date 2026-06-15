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

test("inbox email threads + reply composer", async ({ authed }) => {
  // Switching to Email groups the conversation into subject-threads (C05 has two:
  // "Visiting this Sunday" and "Children's ministry"), each with its own Reply.
  // The composer defaults to replying into the latest thread — its target chip
  // names it and the subject field is hidden (the thread owns the subject).
  await gotoAndSettle(authed, "/inbox?c=C05")
  await authed.waitForTimeout(400)
  await authed.getByRole("radio", { name: /email/i }).click()
  await authed.waitForTimeout(300)
  await expect(authed.getByText("Visiting this Sunday").first()).toBeVisible()
  await expect(authed.getByText("Children's ministry").first()).toBeVisible()
  // Replying into the latest thread by default → the "New email" escape shows.
  await expect(authed.getByRole("button", { name: /new email/i })).toBeVisible()
  await authed
    .getByPlaceholder("Write your reply…")
    .fill(
      "Both are a perfect fit. We have a nursery and a preschool class during the 9am, so they'll be right at home. See you Sunday!",
    )
  await authed.waitForTimeout(200)
  await screenshotPage(authed, "inbox-email-composer")
})

test("inbox new email (fresh subject)", async ({ authed }) => {
  // "New email" escapes the reply target and brings back the editable subject
  // field for a brand-new thread.
  await gotoAndSettle(authed, "/inbox?c=C05")
  await authed.waitForTimeout(400)
  await authed.getByRole("radio", { name: /email/i }).click()
  await authed.getByRole("button", { name: /new email/i }).click()
  await expect(authed.getByLabel("Email subject")).toBeVisible()
  await authed.getByLabel("Email subject").fill("A midweek small group for your family")
  await authed
    .getByPlaceholder("Write an email…")
    .fill("Hi Jennifer, I wanted to share a midweek small group that might be a great fit while you settle in.")
  await authed.waitForTimeout(200)
  await screenshotPage(authed, "inbox-email-new")
})

test("inbox email composer controls", async ({ authed }) => {
  // With an active email composer the attach/AI/preview actions render as an
  // inline icon row above the bar (the old "+" menu only survives in the
  // blocker/AI-preview fallback states). Demo advertises the AI affordance
  // (the endpoint itself stays disabled), so the row is deterministic.
  await gotoAndSettle(authed, "/inbox?c=C05")
  await authed.waitForTimeout(400)
  await authed.getByRole("radio", { name: /email/i }).click()
  await expect(authed.getByRole("button", { name: /attach files/i })).toBeVisible()
  await authed.waitForTimeout(200)
  await screenshotPage(authed, "inbox-email-controls")
})

test("new message dialog", async ({ authed }) => {
  // The compose flow for texting a number that isn't a contact yet.
  await gotoAndSettle(authed, "/inbox")
  await authed.getByRole("button", { name: /new message/i }).click()
  await authed.getByRole("heading", { name: /new message/i }).waitFor()
  await authed.waitForTimeout(300)
  await screenshotPage(authed, "new-message-dialog")
})
