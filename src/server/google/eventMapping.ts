/**
 * The single source of truth for translating between a CRM `events` row and a
 * Google Calendar event, mirroring EXACTLY how ms.church reads the calendar
 * (see the church website's `src/routes/calendar.ts` + `home-scripts.ts`). If
 * the website changes how it parses an event, change it here too.
 *
 * Pure + dependency-free on purpose: every rule below is unit-verified against
 * the website's own regexes in `scripts/events/verify-mapping.ts`, so we can
 * trust that an event the CRM writes renders correctly on the public site
 * without a live round-trip.
 *
 * The website contract, condensed:
 *   - title       <- event.summary
 *   - body text   <- event.description with the FIRST `[CTA:...]` tag stripped
 *   - CTA button  <- `[CTA: TEXT | https://url]` in the description (the site
 *                    only renders it when the link is a real http(s) URL)
 *   - flyer image <- the first image attachment (a public Google Drive file),
 *                    shown via https://lh3.googleusercontent.com/d/<id>=w800
 *   - all-day     <- start.date present and start.dateTime absent
 */

/**
 * The church calendar's timezone. The site renders wall-clock times in this
 * zone, and staff operate in it (the church is in Boise), so we anchor every
 * write here. See `gcalStart`/`gcalEnd`.
 */
export const CALENDAR_TIME_ZONE = "America/Boise"

/** Width token the website appends to the Drive render URL. */
const IMAGE_WIDTH = 800

// --- CTA <-> description ----------------------------------------------------

// Mirrors the website's extraction regex verbatim:
//   description.match(/\[CTA:\s*([^|]+)\s*\|\s*([^\]]+)\]/)
const CTA_REGEX = /\[CTA:\s*([^|]+)\s*\|\s*([^\]]+)\]/
// Mirrors the website's strip (no `g` flag — only the first tag is removed):
//   description.replace(/\[CTA:[^\]]+\]/, '')
const CTA_STRIP_REGEX = /\[CTA:[^\]]+\]/

/**
 * Compose the description we store on the Google Calendar event: the human body
 * with a single `[CTA: text | url]` tag appended when a CTA is set. The site
 * strips that tag from the visible body and renders it as the flyer button.
 *
 * Guards: the tag must survive the site's `[^\]]`/`[^|]` character classes, so
 * a `]` in either field or a `|` in the text would corrupt parsing. The Zod
 * schema rejects those up front; here we defensively drop a malformed CTA
 * rather than emit a broken tag.
 */
export function buildEventDescription(input: {
  description?: string | null
  ctaText?: string | null
  ctaUrl?: string | null
}): string {
  const body = (input.description ?? "").trim()
  const text = (input.ctaText ?? "").trim()
  const url = (input.ctaUrl ?? "").trim()

  const ctaOk = text && url && !text.includes("|") && !text.includes("]") && !url.includes("]")
  if (!ctaOk) return body

  const tag = `[CTA: ${text} | ${url}]`
  return body ? `${body}\n\n${tag}` : tag
}

/**
 * Inverse of {@link buildEventDescription}: pull the CTA back out of a calendar
 * event's description and return the cleaned body. Used when importing/syncing
 * events that were authored directly in Google Calendar.
 */
export function parseEventDescription(raw: string | null | undefined): {
  description: string
  ctaText: string | null
  ctaUrl: string | null
} {
  const text = raw ?? ""
  const match = text.match(CTA_REGEX)
  const cleaned = text.replace(CTA_STRIP_REGEX, "").trim()
  return {
    description: cleaned,
    ctaText: match ? match[1].trim() : null,
    ctaUrl: match ? match[2].trim() : null,
  }
}

/**
 * Whether a CTA URL is one the site will actually render as a button. The
 * website only shows the overlay button for real http(s) links (not anchors
 * like `#contact`), so the editor warns when a CTA wouldn't appear publicly.
 */
export function ctaIsLive(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url.trim())
}

// --- Drive image <-> attachment ---------------------------------------------

/** The public render URL the website builds from a Drive file id. */
export function publicImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${IMAGE_WIDTH}`
}

/**
 * Extract a Drive file id from a calendar attachment, matching the website's
 * fallback: prefer the explicit `fileId`, else parse a `/d/<id>` or `?id=<id>`
 * out of the `fileUrl`.
 */
export function attachmentFileId(att: {
  fileId?: string | null
  fileUrl?: string | null
}): string | null {
  if (att.fileId) return att.fileId
  if (att.fileUrl) {
    const m = att.fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)/)
    if (m) return m[1] ?? m[2] ?? null
  }
  return null
}

/** Build the attachment array for a calendar event from a Drive file id. */
export function buildAttachment(input: {
  driveFileId: string
  title?: string | null
  mimeType?: string | null
}): GcalAttachment[] {
  return [
    {
      fileId: input.driveFileId,
      fileUrl: `https://drive.google.com/file/d/${input.driveFileId}/view`,
      title: input.title?.trim() || "Event flyer",
      mimeType: input.mimeType || "image/jpeg",
    },
  ]
}

// --- date helpers -----------------------------------------------------------

/**
 * The calendar-local (Boise) Y-M-D for an instant, e.g. "2026-07-04". Uses the
 * Intl engine (no tz dependency) so an all-day date never lands on the wrong
 * day due to a UTC midnight rollover.
 */
export function calendarDate(iso: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

/** Add `n` days to a "YYYY-MM-DD" string (calendar-date math, no tz drift). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

// --- row -> Google Calendar payload -----------------------------------------

export type GcalAttachment = {
  fileId?: string
  fileUrl: string
  title?: string
  mimeType?: string
}

export type GcalEventPayload = {
  summary: string
  description?: string
  location?: string
  start: { date: string } | { dateTime: string; timeZone: string }
  end: { date: string } | { dateTime: string; timeZone: string }
  attachments?: GcalAttachment[]
}

/** The subset of a CRM events row this module needs to build a calendar event. */
export type EventForGcal = {
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string | null
  cta_text: string | null
  cta_url: string | null
  image_drive_file_id: string | null
}

/**
 * Build the Google Calendar event body (for insert/patch) from a CRM event row.
 * Timed events are sent as an instant + `timeZone`, which Google stores and the
 * site renders in Boise wall-clock; all-day events use exclusive end dates.
 */
export function eventToGcalPayload(ev: EventForGcal): GcalEventPayload {
  const payload: GcalEventPayload = {
    summary: ev.title.trim(),
    description: buildEventDescription({
      description: ev.description,
      ctaText: ev.cta_text,
      ctaUrl: ev.cta_url,
    }),
    ...(ev.location?.trim() ? { location: ev.location.trim() } : {}),
    start: ev.all_day
      ? { date: calendarDate(ev.starts_at) }
      : { dateTime: new Date(ev.starts_at).toISOString(), timeZone: CALENDAR_TIME_ZONE },
    end: ev.all_day
      ? {
          // Google all-day end is exclusive; a single-day event ends the next
          // day. Multi-day uses the (exclusive) day after ends_at.
          date: addDays(
            ev.ends_at ? calendarDate(ev.ends_at) : calendarDate(ev.starts_at),
            1,
          ),
        }
      : {
          dateTime: new Date(
            ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + 60 * 60 * 1000).toISOString(),
          ).toISOString(),
          timeZone: CALENDAR_TIME_ZONE,
        },
  }
  if (ev.image_drive_file_id) {
    payload.attachments = buildAttachment({ driveFileId: ev.image_drive_file_id })
  }
  return payload
}

// --- Google Calendar event -> row -------------------------------------------

/** The subset of a Google Calendar API event we read when importing. */
export type GcalEvent = {
  id: string
  status?: string
  eventType?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  creator?: { email?: string }
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  attachments?: Array<{ mimeType?: string; fileId?: string; fileUrl?: string }>
}

/** Normalized fields parsed out of a calendar event, ready to upsert into `events`. */
export type ImportedEvent = {
  gcal_event_id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string | null
  cta_text: string | null
  cta_url: string | null
  image_drive_file_id: string | null
  image_public_url: string | null
  status: "published" | "cancelled"
}

/** Whether the website would include this event (default type, not a holiday). */
export function isWebsiteVisible(ev: GcalEvent): boolean {
  if (ev.eventType && ev.eventType !== "default") return false
  if ((ev.creator?.email ?? "").includes("holiday@group.v.calendar.google.com")) return false
  return true
}

/**
 * Convert a Google Calendar event into the fields we store. Mirrors the
 * website's all-day detection, CTA stripping, and first-image-attachment rule.
 * All-day instants are anchored at noon UTC so the Boise calendar date never
 * rolls back a day.
 */
export function gcalEventToRow(ev: GcalEvent): ImportedEvent {
  const allDay = !!ev.start?.date && !ev.start?.dateTime
  const startsAt = allDay
    ? new Date(`${ev.start!.date}T12:00:00Z`).toISOString()
    : new Date(ev.start?.dateTime ?? `${ev.start?.date}T12:00:00Z`).toISOString()
  const endsAt = allDay
    ? null
    : ev.end?.dateTime
      ? new Date(ev.end.dateTime).toISOString()
      : null

  const { description, ctaText, ctaUrl } = parseEventDescription(ev.description)

  let driveFileId: string | null = null
  if (ev.attachments && ev.attachments.length > 0) {
    const image = ev.attachments.find((a) => a.mimeType?.startsWith("image/")) ?? ev.attachments[0]
    driveFileId = attachmentFileId(image)
  }

  return {
    gcal_event_id: ev.id,
    title: ev.summary?.trim() || "Untitled event",
    description: description || null,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    location: ev.location?.trim() || null,
    cta_text: ctaText,
    cta_url: ctaUrl,
    image_drive_file_id: driveFileId,
    image_public_url: driveFileId ? publicImageUrl(driveFileId) : null,
    status: ev.status === "cancelled" ? "cancelled" : "published",
  }
}
