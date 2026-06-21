/**
 * Verifies the CRM's event <-> Google Calendar mapping against the EXACT regexes
 * ms.church uses to read the calendar, so we can trust that events the CRM
 * writes render correctly on the public site without a live round-trip.
 *
 * Run: npx tsx scripts/events/verify-mapping.ts  (or `npm run verify:events`)
 *
 * Uses a relative import (no `@/` alias) so it runs under plain tsx, like the
 * ai-eval scripts. eventMapping is dependency-free, so this is pure + fast.
 *
 * When the ms.church repo is checked out as a sibling (../MS.church), this also
 * reads the website's actual parser source and asserts the regexes below are
 * still copied verbatim — the drift guard. It skips that block (without failing)
 * when the sibling isn't present, so the CRM repo verifies standalone in CI.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  buildEventDescription,
  parseEventDescription,
  publicImageUrl,
  buildAttachment,
  attachmentFileId,
  eventToGcalPayload,
  gcalEventToRow,
  isWebsiteVisible,
  ctasForRow,
  type EventForGcal,
  type GcalEvent,
} from "../../src/server/google/eventMapping"

// --- the website's own regexes (copied verbatim from ms.church) -------------
// src/routes/calendar.ts. The drift guard below re-reads that file and asserts
// these literals still appear in it.
const SITE_CTA_EXTRACT = /\[CTA:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]/g
const SITE_COST = /\[Cost:\s*([^\]]+?)\s*\]/i
const SITE_AGES = /\[Ages:\s*([^\]]+?)\s*\]/i
const SITE_RSVP = /\[RSVP by:\s*([^\]]+?)\s*\]/i
const SITE_TAG_STRIP = /\[(?:CTA|Cost|Ages|RSVP by):[^\]]*\]/gi
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

const baseRow = {
  cta_text: null,
  cta_url: null,
  secondary_cta_text: null,
  secondary_cta_url: null,
  cost: null,
  ages: null,
  rsvp_by: null,
} as const

console.log("CTA serialization round-trips with the site's parser:")
{
  const desc = buildEventDescription({
    description: "Come celebrate with us.",
    ctas: [{ text: "Reserve your seat", url: "https://ms.church/form?ev=1&x=2" }],
  })
  const m = [...desc.matchAll(SITE_CTA_EXTRACT)]
  check("site regex finds the CTA tag", m.length === 1)
  check("site reads the button text", m[0]?.[1].trim() === "Reserve your seat")
  check("site reads the button link", m[0]?.[2].trim() === "https://ms.church/form?ev=1&x=2")
  check("site-stripped body matches our body", desc.replace(SITE_TAG_STRIP, "").trim() === "Come celebrate with us.")

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
    buildEventDescription({ description: "Body", ctas: [{ text: "Bad]text", url: "https://x.com" }] }) === "Body",
  )
  check(
    "CTA with no body emits just the tag",
    buildEventDescription({ ctas: [{ text: "Go", url: "https://x.com" }] }) === "[CTA: Go | https://x.com]",
  )
}

console.log("Multiple CTAs round-trip in order:")
{
  const desc = buildEventDescription({
    description: "Big day.",
    ctas: [
      { text: "Reserve", url: "https://ms.church/form" },
      { text: "Directions", url: "https://maps.example/x" },
    ],
  })
  const m = [...desc.matchAll(SITE_CTA_EXTRACT)]
  check("site sees both CTA tags", m.length === 2)
  check("site reads primary first", m[0]?.[1].trim() === "Reserve")
  check("site reads secondary second", m[1]?.[1].trim() === "Directions")
  const parsed = parseEventDescription(desc)
  check("our parser recovers both CTAs", parsed.ctas.length === 2 && parsed.ctas[1].url === "https://maps.example/x")
  check("primary echoes ctaText/ctaUrl", parsed.ctaText === "Reserve" && parsed.ctaUrl === "https://ms.church/form")
}

console.log("Structured facts (Cost / Ages / RSVP by) round-trip:")
{
  const desc = buildEventDescription({
    description: "A free community celebration.",
    cost: "Free",
    ages: "All ages",
    rsvpBy: "April 1",
    ctas: [{ text: "RSVP", url: "https://ms.church/form" }],
  })
  check("site finds Cost", desc.match(SITE_COST)?.[1].trim() === "Free")
  check("site finds Ages", desc.match(SITE_AGES)?.[1].trim() === "All ages")
  check("site finds RSVP by", desc.match(SITE_RSVP)?.[1].trim() === "April 1")
  check("site-stripped body drops all tags", desc.replace(SITE_TAG_STRIP, "").trim() === "A free community celebration.")

  const parsed = parseEventDescription(desc)
  check("our parser recovers cost", parsed.cost === "Free")
  check("our parser recovers ages", parsed.ages === "All ages")
  check("our parser recovers rsvpBy", parsed.rsvpBy === "April 1")
  check("our parser keeps a clean body", parsed.description === "A free community celebration.")
  // Facts with a `]` are dropped rather than corrupting the parse.
  check("malformed fact dropped", !buildEventDescription({ cost: "Free]x" }).includes("Cost"))
}

console.log("Description link parsing (legacy hand-authored conventions):")
{
  const labeled = parseEventDescription("Come early! Get Directions: https://maps.example/x?a=1&b=2")
  check("labeled link -> button text", labeled.ctaText === "Get Directions")
  check("labeled link -> url", labeled.ctaUrl === "https://maps.example/x?a=1&b=2")
  check("labeled link pulled out of the body", labeled.description === "Come early!")

  const bare = parseEventDescription("More info https://ms.church/form")
  check("bare url -> Learn more", bare.ctaText === "Learn more")
  check("bare url -> url", bare.ctaUrl === "https://ms.church/form")

  const explicit = parseEventDescription("Body [CTA: RSVP | https://x.com] and Directions: https://y.com")
  check("explicit [CTA:] wins over a stray link", explicit.ctas.length === 1 && explicit.ctaText === "RSVP")

  const none = parseEventDescription("Just text, no link.")
  check("no link -> no cta", none.ctaUrl === null && none.description === "Just text, no link.")
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
    secondary_cta_text: "RSVP",
    secondary_cta_url: "https://ms.church/form",
    cost: "Free",
    ages: "All ages",
    rsvp_by: "April 1",
    image_drive_file_id: "IMG1",
  }
  const p = eventToGcalPayload(timed)
  check("timed event sends a dateTime", "dateTime" in p.start)
  check("timed event sends the Boise timeZone", "timeZone" in p.start && p.start.timeZone === "America/Boise")
  check("payload carries the attachment", p.attachments?.[0]?.fileId === "IMG1")
  check("payload description includes both CTA tags", [...(p.description ?? "").matchAll(SITE_CTA_EXTRACT)].length === 2)
  check("payload description includes the facts", !!p.description?.match(SITE_COST) && !!p.description?.match(SITE_RSVP))
  check("ctasForRow keeps primary then secondary", ctasForRow(timed).map((c) => c.text).join(",") === "Directions,RSVP")

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
    description: "A potluck.\n\n[Cost: Free]\n[Ages: All ages]\n[CTA: RSVP | https://ms.church/form]",
    start: { dateTime: "2026-11-26T18:00:00Z" },
    end: { dateTime: "2026-11-26T20:00:00Z" },
    attachments: [{ mimeType: "image/png", fileId: "FLYER9" }],
  }
  const row = gcalEventToRow(ev)
  check("title from summary", row.title === "Friendsgiving Lunch")
  check("cta parsed from description", row.cta_text === "RSVP" && row.cta_url === "https://ms.church/form")
  check("facts parsed from description", row.cost === "Free" && row.ages === "All ages")
  check("body has every tag stripped", row.description === "A potluck.")
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

// --- drift guard: the website still uses these exact regexes ----------------
console.log("Drift guard (ms.church sibling):")
{
  const here = dirname(fileURLToPath(import.meta.url))
  const sitePath = resolve(here, "../../../MS.church/src/routes/calendar.ts")
  let site: string | null = null
  try {
    site = readFileSync(sitePath, "utf8")
  } catch {
    console.log("  · ms.church not checked out as a sibling — skipping (CRM verifies standalone)")
  }
  if (site) {
    // Compare the regex SOURCE (the literal between slashes) so flag differences
    // like our verify-only /g and /i don't cause false negatives.
    const want = [
      String.raw`\[CTA:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]`,
      String.raw`\[Cost:\s*([^\]]+?)\s*\]`,
      String.raw`\[Ages:\s*([^\]]+?)\s*\]`,
      String.raw`\[RSVP by:\s*([^\]]+?)\s*\]`,
      String.raw`\[(?:CTA|Cost|Ages|RSVP by):[^\]]*\]`,
    ]
    for (const w of want) {
      check(`site source contains  ${w}`, site.includes(w))
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log("\nAll event-mapping checks passed.")
