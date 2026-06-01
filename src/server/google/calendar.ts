import "server-only"
import {
  CALENDAR_TIME_ZONE,
  eventToGcalPayload,
  gcalEventToRow,
  isWebsiteVisible,
  type EventForGcal,
  type GcalEvent,
  type ImportedEvent,
} from "./eventMapping"
import {
  GOOGLE_API_KEY,
  GOOGLE_CALENDAR_ID,
  getAccessToken,
  hasGoogleRead,
} from "./auth"

/**
 * Thin Google Calendar v3 REST client (no SDK — same fetch style as the Twilio
 * and SendGrid clients). Reads prefer the OAuth token and fall back to the
 * read-only API key; writes require OAuth and degrade to a mock id when it's
 * absent, so the publish flow works end-to-end before Google is wired up.
 *
 * `supportsAttachments=true` is set on every write so the flyer image (a Drive
 * file) attaches — that attachment is exactly what ms.church renders as the
 * event image.
 */

const BASE = "https://www.googleapis.com/calendar/v3"

export type CalendarWriteResult =
  | { ok: true; gcalEventId: string; htmlLink: string | null; mock: boolean }
  | { ok: false; error: string }

function eventsUrl(suffix = ""): URL {
  return new URL(
    `${BASE}/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events${suffix}`,
  )
}

/**
 * List events for sync. Returns the normalized, website-visible events (default
 * type, not holidays) over the last `timeMinDaysAgo` days — matching the window
 * the website itself reads.
 */
export async function listCalendarEvents(opts?: {
  timeMinDaysAgo?: number
  maxResults?: number
}): Promise<
  { ok: true; events: ImportedEvent[]; mock: boolean } | { ok: false; error: string }
> {
  if (!hasGoogleRead()) return { ok: true, events: [], mock: true }

  const url = eventsUrl()
  url.searchParams.set("singleEvents", "true")
  url.searchParams.set("orderBy", "startTime")
  url.searchParams.set("maxResults", String(opts?.maxResults ?? 250))
  url.searchParams.set("timeZone", CALENDAR_TIME_ZONE)
  url.searchParams.set("eventTypes", "default")
  url.searchParams.set("supportsAttachments", "true")
  url.searchParams.set("showDeleted", "false")
  const since = new Date()
  since.setDate(since.getDate() - (opts?.timeMinDaysAgo ?? 365))
  url.searchParams.set("timeMin", since.toISOString())

  const token = await getAccessToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  else if (GOOGLE_API_KEY) url.searchParams.set("key", GOOGLE_API_KEY)

  const res = await fetch(url.toString(), { headers, cache: "no-store" })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `calendar_list_failed: ${res.status} ${text}`.trim() }
  }
  const data = (await res.json()) as { items?: GcalEvent[] }
  const events = (data.items ?? []).filter(isWebsiteVisible).map(gcalEventToRow)
  return { ok: true, events, mock: false }
}

export async function createCalendarEvent(ev: EventForGcal): Promise<CalendarWriteResult> {
  const token = await getAccessToken()
  if (!token) {
    return { ok: true, gcalEventId: `MOCK_${crypto.randomUUID()}`, htmlLink: null, mock: true }
  }
  const url = eventsUrl()
  url.searchParams.set("supportsAttachments", "true")
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventToGcalPayload(ev)),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `calendar_create_failed: ${res.status} ${text}`.trim() }
  }
  const json = (await res.json()) as { id: string; htmlLink?: string }
  return { ok: true, gcalEventId: json.id, htmlLink: json.htmlLink ?? null, mock: false }
}

export async function updateCalendarEvent(
  gcalEventId: string,
  ev: EventForGcal,
): Promise<CalendarWriteResult> {
  const token = await getAccessToken()
  if (!token) return { ok: true, gcalEventId, htmlLink: null, mock: true }

  const url = eventsUrl(`/${encodeURIComponent(gcalEventId)}`)
  url.searchParams.set("supportsAttachments", "true")
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventToGcalPayload(ev)),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `calendar_update_failed: ${res.status} ${text}`.trim() }
  }
  const json = (await res.json()) as { id: string; htmlLink?: string }
  return { ok: true, gcalEventId: json.id, htmlLink: json.htmlLink ?? null, mock: false }
}

/**
 * Cancel an event by setting its status to `cancelled` (the website drops
 * cancelled events). We patch rather than delete so the row keeps its history
 * and the public site simply stops showing it.
 */
export async function cancelCalendarEvent(
  gcalEventId: string,
): Promise<{ ok: boolean; error?: string; mock?: boolean }> {
  const token = await getAccessToken()
  if (!token) return { ok: true, mock: true }
  const url = eventsUrl(`/${encodeURIComponent(gcalEventId)}`)
  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `calendar_cancel_failed: ${res.status} ${text}`.trim() }
  }
  return { ok: true, mock: false }
}

/** Hard-delete an event from the calendar (idempotent: 404/410 count as done). */
export async function deleteCalendarEvent(
  gcalEventId: string,
): Promise<{ ok: boolean; error?: string; mock?: boolean }> {
  const token = await getAccessToken()
  if (!token) return { ok: true, mock: true }
  const url = eventsUrl(`/${encodeURIComponent(gcalEventId)}`)
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "")
    return { ok: false, error: `calendar_delete_failed: ${res.status} ${text}`.trim() }
  }
  return { ok: true, mock: false }
}
