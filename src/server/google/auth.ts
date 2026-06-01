import "server-only"

/**
 * Google credentials + access-token minting for the Events feature.
 *
 * Capability ladder (mirrors the Twilio/SendGrid degrade-to-mock pattern so the
 * whole feature + harness run before Google is wired up):
 *   - no creds                       -> mock mode (events save locally; publish is logged)
 *   - GOOGLE_CALENDAR_API_KEY only   -> read/sync the public calendar (no writes)
 *   - GOOGLE_OAUTH_* set             -> full read + write (create/edit/delete events,
 *                                       upload + share flyer images on Drive)
 *
 * Writes need OAuth because they act AS the church Google account (the same
 * account that owns the calendar ms.church reads), so flyer images live in that
 * account's own Drive and are trivially shareable publicly — exactly mirroring
 * the manual workflow the church does today.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token"

/** The calendar ms.church reads. Overridable, defaults to the church calendar. */
export const GOOGLE_CALENDAR_ID =
  process.env.GOOGLE_CALENDAR_ID || "morningstarchurchboise@gmail.com"

/** Optional Drive folder to hold flyer images (else they land in My Drive root). */
export const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null

/** Read-only API key (same kind the website uses); reads only, never writes. */
export const GOOGLE_API_KEY = process.env.GOOGLE_CALENDAR_API_KEY || null

/** Whether write operations (create/edit/delete events, Drive uploads) are live. */
export function hasGoogleWrite(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  )
}

/** Whether we can read the calendar at all (OAuth or a bare API key). */
export function hasGoogleRead(): boolean {
  return hasGoogleWrite() || Boolean(GOOGLE_API_KEY)
}

// Access tokens last ~1h; cache in module memory and refresh just before expiry.
let cached: { value: string; expiresAt: number } | null = null

/**
 * Mint (or reuse) an OAuth access token from the stored refresh token. Returns
 * null when OAuth isn't configured — callers treat null as "mock / read-only".
 */
export async function getAccessToken(): Promise<string | null> {
  if (!hasGoogleWrite()) return null
  const now = Date.now()
  if (cached && now < cached.expiresAt - 60_000) return cached.value

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
    grant_type: "refresh_token",
  })
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`google_oauth_token_failed: ${res.status} ${text}`.trim())
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { value: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}
