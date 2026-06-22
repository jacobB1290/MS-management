import "server-only"
import { getYouTubeAccessToken } from "./captions"

/**
 * Latest-video detection off the church YouTube channel's public RSS feed.
 *
 * No API key, no OAuth — the feed at youtube.com/feeds/videos.xml is public and
 * is exactly what ms.church already uses to surface the most recent service.
 * The sermon pipeline only needs this to learn "what is the newest video id";
 * caption download (which DOES need OAuth) lives in ./captions.
 *
 * The playlist id is the church's "service uploads" playlist, kept byte-for-byte
 * identical to ms.church's src/config.ts YOUTUBE_CONFIG.PLAYLIST_ID. If that
 * changes on the site, change it here too.
 */

export const YOUTUBE_PLAYLIST_ID =
  process.env.YOUTUBE_PLAYLIST_ID || "PLHs3usNpG0bZHnAJlIpwBtkbnd7xDCeRC"

export type FeedVideo = {
  videoId: string
  title: string
  publishedAt: string | null
  thumbnailUrl: string
}

function thumb(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
}

/** Parse the Atom feed entries into our shape, newest first (feed order). */
function parseEntries(xml: string, limit: number): FeedVideo[] {
  const videos: FeedVideo[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(xml)) !== null && videos.length < limit) {
    const block = m[1]
    const idMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)
    if (!idMatch) continue
    const titleMatch = block.match(/<title>([^<]+)<\/title>/)
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/)
    videos.push({
      videoId: idMatch[1],
      title: titleMatch ? decodeXml(titleMatch[1]) : "Sunday Service",
      publishedAt: publishedMatch ? publishedMatch[1] : null,
      thumbnailUrl: thumb(idMatch[1]),
    })
  }
  return videos
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()
}

/** Recent videos from the church playlist, newest first. Empty array on failure. */
export async function fetchRecentVideos(limit = 5): Promise<FeedVideo[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${YOUTUBE_PLAYLIST_ID}`
  try {
    const res = await fetch(feedUrl, {
      cache: "no-store",
      headers: { "User-Agent": "ms-management-sermon-pipeline" },
    })
    if (!res.ok) return []
    return parseEntries(await res.text(), limit)
  } catch {
    return []
  }
}

/** The single newest video, or null if the feed is unreachable/empty. */
export async function fetchLatestVideo(): Promise<FeedVideo | null> {
  const [latest] = await fetchRecentVideos(1)
  return latest ?? null
}

/**
 * The FULL playlist (back catalog), newest first, via the YouTube Data API
 * `playlistItems.list` — the RSS feed above only returns the latest ~15, which
 * is enough for "what's new" but not for backfilling years of services. Needs
 * read access: the channel-owner OAuth token (same one captions use) or a public
 * API key (`GOOGLE_YOUTUBE_API_KEY` / `GOOGLE_CALENDAR_API_KEY`). Returns [] when
 * neither is configured (mock mode) so the backfill UI degrades to empty, never
 * throws. Paginated; capped at `maxPages` * 50 so a huge channel can't run away.
 */
export async function fetchAllPlaylistVideos(maxPages = 40): Promise<FeedVideo[]> {
  const apiKey = process.env.GOOGLE_YOUTUBE_API_KEY || process.env.GOOGLE_CALENDAR_API_KEY
  const token = apiKey ? null : await getYouTubeAccessToken().catch(() => null)
  if (!apiKey && !token) return []

  const out: FeedVideo[] = []
  let pageToken: string | undefined
  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems")
      url.searchParams.set("part", "snippet,contentDetails")
      url.searchParams.set("playlistId", YOUTUBE_PLAYLIST_ID)
      url.searchParams.set("maxResults", "50")
      if (pageToken) url.searchParams.set("pageToken", pageToken)
      if (apiKey) url.searchParams.set("key", apiKey)
      const res = await fetch(url.toString(), {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) break
      const json = (await res.json()) as {
        nextPageToken?: string
        items?: {
          snippet?: { title?: string; resourceId?: { videoId?: string } }
          contentDetails?: { videoId?: string; videoPublishedAt?: string }
        }[]
      }
      for (const it of json.items ?? []) {
        const videoId = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId
        if (!videoId) continue
        out.push({
          videoId,
          title: it.snippet?.title?.trim() || "Sunday Service",
          publishedAt: it.contentDetails?.videoPublishedAt ?? null,
          thumbnailUrl: thumb(videoId),
        })
      }
      pageToken = json.nextPageToken
      if (!pageToken) break
    }
  } catch {
    return out
  }
  // De-dupe (a video can appear twice in a playlist) and sort newest-first.
  const seen = new Set<string>()
  return out
    .filter((v) => (seen.has(v.videoId) ? false : (seen.add(v.videoId), true)))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
}
