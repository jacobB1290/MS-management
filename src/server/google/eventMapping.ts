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
 *   - body text   <- event.description with EVERY structured tag stripped
 *   - facts        <- `[Cost: …]` `[Ages: …]` `[RSVP by: …]` tags (shown in the
 *                    event detail view as a labeled facts row)
 *   - CTA buttons <- one or more `[CTA: TEXT | https://url]` tags (the site only
 *                    renders a button when the link is a real http(s) URL)
 *   - location    <- event.location (shown in the detail view + a maps link)
 *   - flyer image <- the first image attachment (a public Google Drive file),
 *                    shown via https://lh3.googleusercontent.com/d/<id>=w800
 *   - all-day     <- start.date present and start.dateTime absent
 *
 * The format is a superset of the original `[CTA: text | url]`-only scheme, so
 * events authored before this (and events hand-typed in Google Calendar) keep
 * parsing: a single CTA, facts absent, body is everything else. A hand-authored
 * "Label: https://…" or bare URL still becomes a button when no `[CTA:]` tag is
 * present.
 */

/**
 * The church calendar's timezone. The site renders wall-clock times in this
 * zone, and staff operate in it (the church is in Boise), so we anchor every
 * write here. See `gcalStart`/`gcalEnd`.
 */
export const CALENDAR_TIME_ZONE = "America/Boise"

/** Width token the website appends to the Drive render URL. */
const IMAGE_WIDTH = 800

// --- structured tags <-> description ----------------------------------------

// Mirrors the website's extraction regexes verbatim (kept in lockstep with
// ms.church's `src/routes/calendar.ts`; `verify-mapping.ts` re-copies them and
// asserts the round-trip). CTA is global — multiple buttons are allowed; the
// first is the primary one shown on the card.
const CTA_REGEX = /\[CTA:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]/g
const COST_REGEX = /\[Cost:\s*([^\]]+?)\s*\]/i
const AGES_REGEX = /\[Ages:\s*([^\]]+?)\s*\]/i
const RSVP_REGEX = /\[RSVP by:\s*([^\]]+?)\s*\]/i
// Strips every recognized tag from the visible body (the site shows the body in
// the event detail view, so leftover tags would read as raw text).
const TAG_STRIP_REGEX = /\[(?:CTA|Cost|Ages|RSVP by):[^\]]*\]/gi
// The site ALSO turns a plain link in the body into a button when no explicit
// `[CTA:]` tag exists: a "Label: https://…" pattern (label becomes the button
// text) or a bare URL ("Learn more"). These mirror ms.church verbatim.
const LABELED_LINK_REGEX = /([A-Za-z][A-Za-z0-9 ]{0,30}?)\s*:\s*(https?:\/\/[^\s<>"']+)/
const BARE_LINK_REGEX = /https?:\/\/[^\s<>"']+/
const TRAILING_PUNCT = /[.,;)\]]+$/

/** A single call-to-action button (text + link). */
export type EventCta = { text: string; url: string }

/** The structured fields encoded into (and parsed out of) the gcal description. */
export type EventStructured = {
  description?: string | null
  ctas?: EventCta[] | null
  cost?: string | null
  ages?: string | null
  rsvpBy?: string | null
}

/** Whether a tag value is safe to serialize without corrupting the site parser. */
function safeValue(v: string | null | undefined): string {
  return (v ?? "").trim()
}
function ctaIsSerializable(c: EventCta): boolean {
  const text = safeValue(c.text)
  const url = safeValue(c.url)
  return (
    !!text && !!url && !text.includes("|") && !text.includes("]") && !url.includes("]")
  )
}

/**
 * Compose the description we store on the Google Calendar event: the human body,
 * then a block of structured tags (facts first, then one `[CTA:]` per button).
 * The site strips every tag from the visible body and renders them as the facts
 * row + the flyer button(s).
 *
 * Guards: tag values must survive the site's `[^\]]`/`[^|]` character classes,
 * so a `]` (or a `|` in CTA text) would corrupt parsing. The Zod schema rejects
 * those up front; here we defensively drop a malformed tag rather than emit a
 * broken one.
 */
export function buildEventDescription(input: EventStructured): string {
  const body = safeValue(input.description)
  const tags: string[] = []

  const cost = safeValue(input.cost)
  if (cost && !cost.includes("]")) tags.push(`[Cost: ${cost}]`)
  const ages = safeValue(input.ages)
  if (ages && !ages.includes("]")) tags.push(`[Ages: ${ages}]`)
  const rsvpBy = safeValue(input.rsvpBy)
  if (rsvpBy && !rsvpBy.includes("]")) tags.push(`[RSVP by: ${rsvpBy}]`)

  for (const cta of input.ctas ?? []) {
    if (ctaIsSerializable(cta)) tags.push(`[CTA: ${cta.text.trim()} | ${cta.url.trim()}]`)
  }

  if (tags.length === 0) return body
  const tagBlock = tags.join("\n")
  return body ? `${body}\n\n${tagBlock}` : tagBlock
}

/**
 * Inverse of {@link buildEventDescription}: pull the structured fields back out
 * of a calendar event's description and return the cleaned body. Used when
 * importing/syncing events authored directly in Google Calendar, and by the
 * editor to lift a hand-typed link into a button.
 *
 * `ctaText`/`ctaUrl` echo the PRIMARY CTA so existing single-CTA callers keep
 * working unchanged.
 */
export function parseEventDescription(raw: string | null | undefined): {
  description: string
  ctaText: string | null
  ctaUrl: string | null
  ctas: EventCta[]
  cost: string | null
  ages: string | null
  rsvpBy: string | null
} {
  const text = raw ?? ""

  // Explicit [CTA:] tags (zero or more). The global regex needs a fresh
  // lastIndex per call, which a literal in a function scope gives us.
  const ctas: EventCta[] = []
  for (const m of text.matchAll(CTA_REGEX)) {
    ctas.push({ text: m[1].trim(), url: m[2].trim() })
  }

  const cost = text.match(COST_REGEX)?.[1].trim() ?? null
  const ages = text.match(AGES_REGEX)?.[1].trim() ?? null
  const rsvpBy = text.match(RSVP_REGEX)?.[1].trim() ?? null

  // Body = everything with the recognized tags removed, blank runs collapsed.
  let body = text.replace(TAG_STRIP_REGEX, "")

  // Legacy fallback: when there's no explicit [CTA:] tag, the site still turns a
  // link in the body into a button. "Label: url" wins (label = button text),
  // else a bare URL ("Learn more"). Pull the matched link out of the body.
  if (ctas.length === 0) {
    const labeled = body.match(LABELED_LINK_REGEX)
    if (labeled) {
      ctas.push({ text: labeled[1].trim(), url: labeled[2].replace(TRAILING_PUNCT, "") })
      body = body.replace(labeled[0], "")
    } else {
      const bare = body.match(BARE_LINK_REGEX)
      if (bare) {
        ctas.push({ text: "Learn more", url: bare[0].replace(TRAILING_PUNCT, "") })
        body = body.replace(bare[0], "")
      }
    }
  }

  body = body.replace(/\n{3,}/g, "\n\n").trim()

  return {
    description: body,
    ctaText: ctas[0]?.text ?? null,
    ctaUrl: ctas[0]?.url ?? null,
    ctas,
    cost,
    ages,
    rsvpBy,
  }
}

/**
 * Whether a CTA URL is one the site will actually render as a button. The
 * website only shows the button for real http(s) links (not anchors like
 * `#contact`), so the editor warns when a CTA wouldn't appear publicly.
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
  secondary_cta_text: string | null
  secondary_cta_url: string | null
  cost: string | null
  ages: string | null
  rsvp_by: string | null
  image_drive_file_id: string | null
}

/** The ordered, de-duplicated CTA list for a row (primary first, then secondary). */
export function ctasForRow(ev: {
  cta_text: string | null
  cta_url: string | null
  secondary_cta_text: string | null
  secondary_cta_url: string | null
}): EventCta[] {
  const out: EventCta[] = []
  if (ev.cta_text && ev.cta_url) out.push({ text: ev.cta_text, url: ev.cta_url })
  if (ev.secondary_cta_text && ev.secondary_cta_url) {
    out.push({ text: ev.secondary_cta_text, url: ev.secondary_cta_url })
  }
  return out
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
      ctas: ctasForRow(ev),
      cost: ev.cost,
      ages: ev.ages,
      rsvpBy: ev.rsvp_by,
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
  secondary_cta_text: string | null
  secondary_cta_url: string | null
  cost: string | null
  ages: string | null
  rsvp_by: string | null
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
 * website's all-day detection, tag stripping, and first-image-attachment rule.
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

  const { description, ctas, cost, ages, rsvpBy } = parseEventDescription(ev.description)

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
    cta_text: ctas[0]?.text ?? null,
    cta_url: ctas[0]?.url ?? null,
    secondary_cta_text: ctas[1]?.text ?? null,
    secondary_cta_url: ctas[1]?.url ?? null,
    cost,
    ages,
    rsvp_by: rsvpBy,
    image_drive_file_id: driveFileId,
    image_public_url: driveFileId ? publicImageUrl(driveFileId) : null,
    status: ev.status === "cancelled" ? "cancelled" : "published",
  }
}
