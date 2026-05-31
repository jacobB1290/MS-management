import { ImageResponse } from "next/og"

export const contentType = "image/png"

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/**
 * iOS launch screen, generated to the exact device pixel size requested by the
 * `apple-touch-startup-image` link (see lib/ios-startup-images.ts). Matches the
 * app icon's brand — warm cream field, gold serif "M" — with the wordmark below
 * so the cold-launch screen reads like a native splash instead of a blank page.
 */
export function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Bound the size: these URLs are fixed in our own link tags, but never let a
  // crafted query spin up an enormous render.
  const w = clamp(Math.round(Number(searchParams.get("w")) || 1170), 200, 2400)
  const h = clamp(Math.round(Number(searchParams.get("h")) || 2532), 200, 3200)

  const min = Math.min(w, h)
  const mark = Math.round(min * 0.3)
  const wordmark = Math.round(min * 0.046)
  const sub = Math.round(min * 0.03)

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#f6f1ea",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            fontSize: mark,
            fontWeight: 600,
            color: "#9d7853",
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          M
        </div>
        <div
          style={{
            marginTop: Math.round(min * 0.06),
            fontSize: wordmark,
            fontWeight: 600,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#9d7853",
          }}
        >
          Morning Star
        </div>
        <div
          style={{
            marginTop: Math.round(min * 0.02),
            fontSize: sub,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(122, 92, 62, 0.7)",
          }}
        >
          Management
        </div>
      </div>
    ),
    {
      width: w,
      height: h,
      headers: {
        // Brand art, never changes — let iOS and the CDN cache it hard.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  )
}
