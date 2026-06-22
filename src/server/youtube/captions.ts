import "server-only"

/**
 * Transcript retrieval via the YouTube Data API caption endpoints.
 *
 * captions.download only works for the OWNER of the video, so this authenticates
 * AS the church Google account that owns the channel. Capability ladder mirrors
 * the events/Gmail degrade-to-mock pattern:
 *   - no YouTube OAuth creds         -> hasCaptionAccess() === false, callers no-op
 *   - GOOGLE_YOUTUBE_REFRESH_TOKEN   -> dedicated token (use when the channel is a
 *                                       different Google account than the calendar)
 *   - else GOOGLE_OAUTH_REFRESH_TOKEN with the youtube.force-ssl scope added
 *                                       (when the channel + calendar share one account)
 *
 * Either way the refresh token must carry the `youtube.force-ssl` scope, which is
 * the one credential gap beyond the existing Google setup — see
 * docs/sermons-youtube-setup-runbook.md.
 *
 * We download SRT (tfmt=srt) and parse the cues, so we get both a clean plain
 * transcript and a timestamped one the segmenter uses to place chapter bounds.
 * Auto-generated (ASR) tracks are accepted as a fallback when no human-authored
 * track exists, since the church relies on YouTube's auto-captions.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const API_BASE = "https://www.googleapis.com/youtube/v3"

function ytClientId(): string | undefined {
  return process.env.GOOGLE_YOUTUBE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
}
function ytClientSecret(): string | undefined {
  return process.env.GOOGLE_YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
}
function ytRefreshToken(): string | undefined {
  return process.env.GOOGLE_YOUTUBE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN
}

/** Whether caption download is configured (an OAuth refresh token is present). */
export function hasCaptionAccess(): boolean {
  return Boolean(ytClientId() && ytClientSecret() && ytRefreshToken())
}

let cached: { value: string; expiresAt: number } | null = null

async function getYouTubeAccessToken(): Promise<string | null> {
  if (!hasCaptionAccess()) return null
  const now = Date.now()
  if (cached && now < cached.expiresAt - 60_000) return cached.value

  const body = new URLSearchParams({
    client_id: ytClientId()!,
    client_secret: ytClientSecret()!,
    refresh_token: ytRefreshToken()!,
    grant_type: "refresh_token",
  })
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`youtube_oauth_token_failed: ${res.status} ${text}`.trim())
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { value: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}

type CaptionTrack = {
  id: string
  language: string
  trackKind: string // "standard" | "ASR" | "forced"
  name: string
}

/** Pick the best track: English human-authored, else English ASR, else first. */
function chooseTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  const isEn = (t: CaptionTrack) => t.language?.toLowerCase().startsWith("en")
  const human = tracks.filter((t) => t.trackKind !== "ASR")
  return (
    human.find(isEn) ??
    tracks.find(isEn) ??
    human[0] ??
    tracks[0] ??
    null
  )
}

export type Cue = { startSec: number; endSec: number; text: string }

/** Parse SRT text into ordered cues. Tolerant of CRLF and missing blank lines. */
export function parseSrt(srt: string): Cue[] {
  const cues: Cue[] = []
  const blocks = srt.replace(/\r\n/g, "\n").split(/\n\s*\n/)
  const timeRe =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "")
    if (lines.length === 0) continue
    const timeLineIdx = lines.findIndex((l) => timeRe.test(l))
    if (timeLineIdx === -1) continue
    const m = lines[timeLineIdx].match(timeRe)!
    const startSec =
      Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
    const endSec =
      Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000
    const text = lines
      .slice(timeLineIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip inline caption styling tags
      .replace(/\s+/g, " ")
      .trim()
    if (text) cues.push({ startSec, endSec, text })
  }
  return cues
}

export type TranscriptResult = {
  cues: Cue[]
  /** Clean prose: every cue joined, no timestamps. Stored as sermons.transcript. */
  plainText: string
  /** `[mm:ss] text` lines — fed to the segmenter so it can assign chapter bounds. */
  timestamped: string
  /** Last cue end, a good proxy for service length. */
  durationSec: number
  /** Whether the chosen track was auto-generated (ASR) vs human-authored. */
  isAutoGenerated: boolean
  language: string
}

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(h > 0 ? m : m).padStart(2, "0")
  const ss = String(sec).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export type CaptionFetchResult =
  | { ok: true; transcript: TranscriptResult }
  | { ok: false; reason: "no_access" | "no_captions" | "provider_failed"; detail?: string }

/** Download + parse the best caption track for a video. */
export async function fetchTranscript(videoId: string): Promise<CaptionFetchResult> {
  const token = await getYouTubeAccessToken().catch((e) => {
    throw e
  })
  if (!token) return { ok: false, reason: "no_access" }

  try {
    // 1. List available caption tracks for the video.
    const listRes = await fetch(
      `${API_BASE}/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    )
    if (!listRes.ok) {
      const detail = await listRes.text().catch(() => "")
      return { ok: false, reason: "provider_failed", detail: `captions.list ${listRes.status} ${detail}`.trim() }
    }
    const listed = (await listRes.json()) as {
      items?: { id: string; snippet?: { language?: string; trackKind?: string; name?: string } }[]
    }
    const tracks: CaptionTrack[] = (listed.items ?? []).map((it) => ({
      id: it.id,
      language: it.snippet?.language ?? "",
      trackKind: it.snippet?.trackKind ?? "standard",
      name: it.snippet?.name ?? "",
    }))
    const track = chooseTrack(tracks)
    if (!track) return { ok: false, reason: "no_captions" }

    // 2. Download it as SRT.
    const dlRes = await fetch(
      `${API_BASE}/captions/${encodeURIComponent(track.id)}?tfmt=srt`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    )
    if (!dlRes.ok) {
      const detail = await dlRes.text().catch(() => "")
      return {
        ok: false,
        reason: "provider_failed",
        detail: `captions.download ${dlRes.status} ${detail}`.trim(),
      }
    }
    const srt = await dlRes.text()
    const cues = parseSrt(srt)
    if (cues.length === 0) return { ok: false, reason: "no_captions" }

    const plainText = cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim()
    const timestamped = cues.map((c) => `[${mmss(c.startSec)}] ${c.text}`).join("\n")
    const durationSec = Math.round(cues[cues.length - 1].endSec)

    return {
      ok: true,
      transcript: {
        cues,
        plainText,
        timestamped,
        durationSec,
        isAutoGenerated: track.trackKind === "ASR",
        language: track.language || "en",
      },
    }
  } catch (err) {
    return {
      ok: false,
      reason: "provider_failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
