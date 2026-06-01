import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

test("events list (upcoming + past)", async ({ authed }) => {
  await gotoAndSettle(authed, "/events")
  await screenshotPage(authed, "events-list")
})

test("event editor with live preview", async ({ authed }) => {
  await gotoAndSettle(authed, "/events/new")
  await screenshotPage(authed, "event-new")
})

test("event detail + edit", async ({ authed }) => {
  await gotoAndSettle(authed, "/events/E01")
  await screenshotPage(authed, "event-detail")
})

test("promote an event (pre-filled campaign)", async ({ authed }) => {
  await gotoAndSettle(authed, "/campaigns/new?event=E01")
  await screenshotPage(authed, "event-promote")
})
