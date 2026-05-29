import "server-only"
import { createHash } from "node:crypto"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { Json } from "@/lib/database.types"

/**
 * Sync the church knowledge base from the live ms.church website. The site is
 * the always-current source of truth, so we pull from it (not the website repo,
 * which would couple this CRM to that codebase's file layout). Reads the
 * sitemap, fetches each content page, extracts the readable text, and upserts
 * one `source='website'` row per page keyed by URL. A content hash skips
 * unchanged pages; pages that drop out of the sitemap are deactivated.
 *
 * Staff-added (`source='staff'`) rows are never touched here.
 *
 * Triggered by the admin "Sync from website" button and the daily GitHub
 * Actions cron (`/api/cron/sync-knowledge`).
 */

/** app_settings key holding the last sync summary (shown in Settings). */
export const KNOWLEDGE_SYNC_KEY = "church_knowledge_sync"

const DEFAULT_BASE = "https://ms.church"
/** Pages that aren't useful knowledge: the form endpoint and the legal page. */
const EXCLUDE_PATHS = new Set(["/form", "/privacy"])
/** Fallback page list if the sitemap can't be read. */
const FALLBACK_PATHS = ["/", "/about", "/beliefs", "/ministries", "/outreach", "/visit"]
const FETCH_TIMEOUT_MS = 15000
const MAX_PAGES = 50
const MAX_BODY_CHARS = 8000

export interface KnowledgeSyncSummary {
  ok: boolean
  base: string
  pages: number
  inserted: number
  updated: number
  unchanged: number
  deactivated: number
  errors: string[]
  ran_at: string
}

export async function syncChurchKnowledgeFromWebsite(): Promise<KnowledgeSyncSummary> {
  const base = (process.env.CHURCH_WEBSITE_URL || DEFAULT_BASE).replace(/\/+$/, "")
  const ranAt = new Date().toISOString()
  const errors: string[] = []
  const admin = createSupabaseAdminClient()

  let baseHost = ""
  try {
    baseHost = new URL(base).host
  } catch {
    baseHost = ""
  }

  const urls = (await fetchSitemapUrls(base, errors))
    .filter((u) => {
      try {
        const parsed = new URL(u)
        const path = parsed.pathname.replace(/\/+$/, "") || "/"
        return parsed.host === baseHost && !EXCLUDE_PATHS.has(path)
      } catch {
        return false
      }
    })
    .slice(0, MAX_PAGES)

  let inserted = 0
  let updated = 0
  let unchanged = 0
  const seenUrls: string[] = []

  for (const url of urls) {
    try {
      const html = await fetchText(url)
      const body = extractReadableText(html).slice(0, MAX_BODY_CHARS)
      if (body.length < 40) {
        errors.push(`thin content: ${url}`)
        continue
      }
      const title = extractTitle(html, url)
      const hash = sha256(`${title}\n${body}`)
      seenUrls.push(url)

      const { data: existing } = await admin
        .from("church_knowledge")
        .select("id, content_hash, is_active")
        .eq("source", "website")
        .eq("source_url", url)
        .maybeSingle()

      if (!existing) {
        const { error } = await admin.from("church_knowledge").insert({
          title,
          body,
          source: "website",
          source_url: url,
          content_hash: hash,
          is_active: true,
        })
        if (error) errors.push(`insert ${url}: ${error.message}`)
        else inserted++
      } else if (existing.content_hash !== hash) {
        const { error } = await admin
          .from("church_knowledge")
          .update({ title, body, content_hash: hash, is_active: true })
          .eq("id", existing.id)
        if (error) errors.push(`update ${url}: ${error.message}`)
        else updated++
      } else if (!existing.is_active) {
        // Same content as before but had been deactivated — bring it back.
        await admin.from("church_knowledge").update({ is_active: true }).eq("id", existing.id)
        updated++
      } else {
        unchanged++
      }
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Deactivate website rows whose page disappeared from the sitemap. Guarded on
  // having actually fetched something, so a total fetch failure never wipes the
  // base (it would otherwise look like every page vanished).
  let deactivated = 0
  if (seenUrls.length > 0) {
    const { data: active } = await admin
      .from("church_knowledge")
      .select("id, source_url")
      .eq("source", "website")
      .eq("is_active", true)
    const staleIds = (active ?? [])
      .filter((r) => !r.source_url || !seenUrls.includes(r.source_url))
      .map((r) => r.id)
    if (staleIds.length > 0) {
      const { error } = await admin
        .from("church_knowledge")
        .update({ is_active: false })
        .in("id", staleIds)
      if (!error) deactivated = staleIds.length
    }
  } else {
    errors.push("no pages fetched; left existing knowledge untouched")
  }

  const summary: KnowledgeSyncSummary = {
    ok: errors.length === 0 && seenUrls.length > 0,
    base,
    pages: seenUrls.length,
    inserted,
    updated,
    unchanged,
    deactivated,
    errors: errors.slice(0, 20),
    ran_at: ranAt,
  }

  // Best-effort: record the summary so Settings can show "last synced".
  await admin
    .from("app_settings")
    .upsert(
      { key: KNOWLEDGE_SYNC_KEY, value: summary as unknown as Json, updated_at: ranAt },
      { onConflict: "key" },
    )

  return summary
}

/** Read the most recent sync summary, if any. */
export async function getLastKnowledgeSync(): Promise<KnowledgeSyncSummary | null> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", KNOWLEDGE_SYNC_KEY)
    .maybeSingle()
  return (data?.value as KnowledgeSyncSummary | null) ?? null
}

async function fetchSitemapUrls(base: string, errors: string[]): Promise<string[]> {
  try {
    const xml = await fetchText(`${base}/sitemap.xml`)
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim())
    if (locs.length > 0) return Array.from(new Set(locs))
    errors.push("sitemap had no <loc> entries; using fallback page list")
  } catch (err) {
    errors.push(`sitemap: ${err instanceof Error ? err.message : String(err)}; using fallback`)
  }
  return FALLBACK_PATHS.map((p) => `${base}${p}`)
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "MorningStarCRM-KnowledgeSync/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml",
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pull readable text out of a page. Prefers the <main> region, drops chrome
 * (nav/footer/script/style/svg) and their text, turns block boundaries into
 * newlines so the result keeps some shape, strips remaining tags, and decodes
 * the common HTML entities.
 */
function extractReadableText(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html
  const cleaned = main
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
  const withBreaks = cleaned
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|h[1-6]|li|ul|ol|section|article|div|tr|blockquote)\s*>/gi, "\n")
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractTitle(html: string, url: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const raw = decodeEntities((h1 ?? titleTag ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  // Drop a trailing " | Morning Star Christian Church" style site suffix.
  const trimmed = raw.split(/\s[|–—]\s/)[0].trim()
  if (trimmed) return trimmed.slice(0, 200)
  // Fall back to a Title-Cased page slug.
  try {
    const slug = new URL(url).pathname.replace(/\/+$/, "").split("/").pop() || "Home"
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  } catch {
    return "Page"
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&mdash;/gi, ", ")
    .replace(/&ndash;/gi, "-")
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}
