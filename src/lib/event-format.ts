/**
 * Event date/time formatting that mirrors how ms.church renders an event card,
 * so the CRM preview matches the public site. All formatting is anchored to the
 * church's timezone (Boise) via the Intl engine — no dependency, no UTC drift.
 *
 * Client-safe (no server-only imports): used by the live editor preview and the
 * events list.
 */

const TZ = "America/Boise"

/** "JUL 4" — the uppercase month + day badge the site shows. */
export function eventDisplayDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(iso))
  const month = parts.find((p) => p.type === "month")?.value.toUpperCase() ?? ""
  const day = parts.find((p) => p.type === "day")?.value ?? ""
  return `${month} ${day}`.trim()
}

/** "Saturday, July 4" — a longer human form for the list + detail header. */
export function eventLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso))
}

function boiseHourMinute(iso: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(iso))
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0)
  return { h, m }
}

function to12h(h: number, m: number): { digits: string; ampm: string } {
  const ampm = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  const mins = m === 0 ? "" : `:${String(m).padStart(2, "0")}`
  return { digits: `${hour}${mins}`, ampm }
}

/**
 * "11 AM – 3 PM" (or "11 AM" with no end), shared AM/PM collapsed exactly like
 * the website. Returns null for all-day events (the site shows no time pill).
 */
export function eventDisplayTime(
  startIso: string,
  endIso: string | null | undefined,
  allDay: boolean,
): string | null {
  if (allDay) return null
  const start = boiseHourMinute(startIso)
  const s = to12h(start.h, start.m)
  if (endIso) {
    const end = boiseHourMinute(endIso)
    const e = to12h(end.h, end.m)
    if (s.ampm === e.ampm) return `${s.digits} – ${e.digits} ${e.ampm}`
    return `${s.digits} ${s.ampm} – ${e.digits} ${e.ampm}`
  }
  return `${s.digits} ${s.ampm}`
}

/** Whether an event's start is in the future (drives the upcoming/past split). */
export function isUpcoming(startIso: string, now: Date = new Date()): boolean {
  return new Date(startIso).getTime() >= now.getTime()
}

/**
 * The URL to actually render a flyer from. Google Drive's `lh3` host is
 * unreliable when hotlinked from the browser, so route those through our
 * same-origin proxy (`/api/events/flyer`); other hosts (our Supabase bucket)
 * load fine and pass through untouched.
 */
export function flyerRenderSrc(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/lh3\.googleusercontent\.com\/d\/([A-Za-z0-9_-]+)/)
  return m ? `/api/events/flyer?id=${m[1]}` : url
}

/** A Google Maps search link for a location string (shown in the detail view). */
export function eventMapsLink(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
}

/** A formatted block of the description body. Mirrors the site's renderer. */
export type EventBodyBlock = { type: "p"; lines: string[] } | { type: "ul"; items: string[] }

/**
 * Light formatting for the description body, byte-for-byte mirroring ms.church's
 * `formatEventBody`: blank lines split paragraphs; a run of "- " / "• " lines
 * becomes a bullet list. Returns structured blocks the preview renders as JSX
 * (no dangerouslySetInnerHTML), so the CRM detail preview matches the site.
 */
export function formatEventBlocks(text: string): EventBodyBlock[] {
  return text
    .split(/\n{2,}/)
    .map((block): EventBodyBlock | null => {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")
      if (lines.length === 0) return null
      if (lines.every((l) => /^[-•]\s+/.test(l))) {
        return { type: "ul", items: lines.map((l) => l.replace(/^[-•]\s+/, "")) }
      }
      return { type: "p", lines }
    })
    .filter((b): b is EventBodyBlock => b !== null)
}
