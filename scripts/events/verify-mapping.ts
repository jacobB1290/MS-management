/**
 * Verifies the CRM's event <-> Google Calendar mapping against the EXACT regexes
 * ms.church uses to read the calendar, so we can trust that events the CRM
 * writes render correctly on the public site without a live round-trip.
 *
 * Run: npx tsx scripts/events/verify-mapping.ts  (or `npm run verify:events`)
 *
 * Uses a relative import (no `@/` alias) so it runs under plain tsx, like the
 * ai-eval scripts. eventMapping is dependency-free, so this is pure + fast.
 */
import {
  buildEventDescription,
  parseEventDescription,
  publicImageUrl,
  buildAttachment,
  attachmentFileId,
  eventToGcalPayload,
  gcalEventToRow,
  isWebsiteVisible,
  type EventForGcal,
  type GcalEvent,
} from "../../src/server/google/eventMapping"

// --- the website's own regexes (copied verbatim from ms.church) -------------
// src/routes/calendar.ts
const SITE_CTA_EXTRACT = /\[CTA:\s*([^|]+)\s*\|\s*([^\]]+)\]/
const SITE_CTA_STRIP = /\[CTA:[^\]]+\]/
const SITE_FILEURL = /\/d\/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)/

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    console.error(`  ✗ ${name}`)
    failures += 1
  }
}

console.log("CTA serialization round-trips with the site's parser:")
{
  const desc = buildEventDescription({
    description: "Come celebrate with us.",
    ctaText: "Reserve your seat",
    ctaUrl: "https://ms.church/form?ev=1&x=2",
  })
  const m = desc.match(SITE_CTA_EXTRACT)
  check("site regex finds the CTA tag", !!m)
  check("site reads the button text", m?.[1].trim() === "Reserve your seat")
  check("site reads the button link", m?.[2].trim() === "https://ms.church/form?ev=1&x=2")
  check("site-stripped body matches our body", desc.replace(SITE_CTA_STRIP, "").trim() === "Come celebrate with us.")

  const parsed = parseEventDescription(desc)
  check("our parser recovers the body", parsed.description === "Come celebrate with us.")
  check("our parser recovers the text", parsed.ctaText === "Reserve your seat")
  check("our parser recovers the url", parsed.ctaUrl === "https://ms.church/form?ev=1&x=2")
}

console.log("CTA edge cases:")
{
  check("no CTA -> body only", buildEventDescription({ description: "Just info" }) === "Just info")
  check("empty everything -> empty string", buildEventDescription({}) === "")
  // A `]` in the text would corrupt the site's `[^\]]` parsing -> we drop the CTA.
  check(
    "malformed CTA text is dropped",
    buildEventDescription({ description: "Body", ctaText: "Bad]text", ctaUrl: "https://x.com" }) === "Body",
  )
  check(
    "CTA with no body emits just the tag",
    buildEventDescription({ ctaText: "Go", ctaUrl: "https://x.com" }) === "[CTA: Go | https://x.com]",
  )
}

console.log("Drive image URL + attachment id extraction:")
{
  check("lh3 render URL matches the site format", publicImageUrl("FILE123") === "https://lh3.googleusercontent.com/d/FILE123=w800")
  const att = buildAttachment({ driveFileId: "FILE123" })
  check("attachment fileUrl is the Drive /file/d/<id>/view form", att[0].fileUrl === "https://drive.google.com/file/d/FILE123/view")
  const m = att[0].fileUrl.match(SITE_FILEURL)
  check("site fileUrl regex extracts our id", (m?.[1] ?? m?.[2]) === "FILE123")
  check("our attachmentFileId prefers explicit fileId", attachmentFileId(att[0]) === "FILE123")
  check("our attachmentFileId parses a fileUrl", attachmentFileId({ fileUrl: "https://drive.google.com/file/d/ABC_9/view" }) === "ABC_9")
}

console.log("Row -> Google Calendar payload:")
{
  const timed: EventForGcal = {
    title: "Easter Park Day",
    description: "Join us",
    starts_at: "2026-04-04T18:00:00.000Z",
    ends_at: "2026-04-04T23:00:00.000Z",
    all_day: false,
    location: "Boise",
    cta_text: "Directions",
    cta_url: "https://maps.example/x",
    image_drive_file_id: "IMG1",
  }
  const p = eventToGcalPayload(timed)
  check("timed event sends a dateTime", "dateTime" in p.start)
  check("timed event sends the Boise timeZone", "timeZone" in p.start && p.start.timeZone === "America/Boise")
  check("payload carries the attachment", p.attachments?.[0]?.fileId === "IMG1")
  check("payload description includes the CTA tag", !!p.description?.match(SITE_CTA_EXTRACT))

  const allDay: EventForGcal = { ...timed, all_day: true, ends_at: null, image_drive_file_id: null }
  const pa = eventToGcalPayload(allDay)
  check("all-day sends a date (not dateTime)", "date" in pa.start)
  check("all-day end is the exclusive next day", "date" in pa.end && (pa.end as { date: string }).date === "2026-04-05")
  check("no image -> no attachments", pa.attachments === undefined)
}

console.log("Google Calendar event -> row (import/sync):")
{
  const ev: GcalEvent = {
    id: "evt1",
    status: "confirmed",
    eventType: "default",
    summary: "Friendsgiving Lunch",
    description: "A potluck.\n\n[CTA: RSVP | https://ms.church/form]",
    start: { dateTime: "2026-11-26T18:00:00Z" },
    end: { dateTime: "2026-11-26T20:00:00Z" },
    attachments: [{ mimeType: "image/png", fileId: "FLYER9" }],
  }
  const row = gcalEventToRow(ev)
  check("title from summary", row.title === "Friendsgiving Lunch")
  check("cta parsed from description", row.cta_text === "RSVP" && row.cta_url === "https://ms.church/form")
  check("body has the CTA stripped", row.description === "A potluck.")
  check("image id from attachment", row.image_drive_file_id === "FLYER9")
  check("image public url derived", row.image_public_url === "https://lh3.googleusercontent.com/d/FLYER9=w800")
  check("timed import is not all-day", row.all_day === false)

  const allDayEv: GcalEvent = { id: "e2", status: "confirmed", summary: "Camp", start: { date: "2026-07-10" }, end: { date: "2026-07-13" } }
  check("all-day import detected", gcalEventToRow(allDayEv).all_day === true)

  const cancelled: GcalEvent = { id: "e3", status: "cancelled", summary: "x", start: { dateTime: "2026-01-01T00:00:00Z" } }
  check("cancelled import status", gcalEventToRow(cancelled).status === "cancelled")

  check("non-default eventType is filtered out", isWebsiteVisible({ id: "h", eventType: "birthday", start: {} }) === false)
  check("holiday creator is filtered out", isWebsiteVisible({ id: "h", creator: { email: "x@holiday@group.v.calendar.google.com" }, start: {} }) === false)
  check("ordinary event is visible", isWebsiteVisible(ev) === true)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log("\nAll event-mapping checks passed.")
