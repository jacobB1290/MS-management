import { NextResponse, type NextRequest } from "next/server"

/**
 * Flyer image passthrough. Google Drive's public image host
 * (`lh3.googleusercontent.com/d/<id>`) serves fine server-to-server but is
 * unreliable when hotlinked directly from an <img> in the browser (Google
 * rate-limits/blocks third-party hotlinks) — which is why ms.church itself
 * routes these through an image optimizer rather than hotlinking them. We do the
 * same: the browser loads this same-origin route, and the server fetches the
 * Drive image once (then it's CDN-cached).
 *
 * SSRF-safe: it ONLY ever fetches `lh3.googleusercontent.com/d/<id>` built from a
 * validated Drive file id — never an arbitrary URL.
 */
const ID_RE = /^[A-Za-z0-9_-]{10,256}$/

export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id") ?? ""
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(`https://lh3.googleusercontent.com/d/${id}=w1000`, {
      // No Referer; let Google serve the public bytes.
      headers: { Accept: "image/*" },
      cache: "no-store",
    })
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream", status: upstream.status }, { status: 502 })
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg"
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image" }, { status: 502 })
  }

  const body = await upstream.arrayBuffer()
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Cache hard at the CDN so Drive isn't hit per view.
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  })
}
