import { test } from "../auth-fixture"
import { gotoAndSettle, screenshotPage } from "../helpers"

/**
 * Sermons — the YouTube → transcript → chapters pipeline + its monitor. Covers
 * the list (status band + latest feature card + poster grid + runs table) and a
 * rich detail (chapters, transcript, search preview, per-sermon run history),
 * across the viewport matrix. SR01 is the in-review fixture with full chapters.
 */

test("sermons monitor (status + library + activity)", async ({ authed }) => {
  await gotoAndSettle(authed, "/sermons")
  await screenshotPage(authed, "sermons-list")
})

test("sermon detail (chapters + transcript + history)", async ({ authed }) => {
  await gotoAndSettle(authed, "/sermons/SR01")
  await screenshotPage(authed, "sermon-detail")
})

test("sermon detail (published)", async ({ authed }) => {
  await gotoAndSettle(authed, "/sermons/SR02")
  await screenshotPage(authed, "sermon-detail-published")
})
