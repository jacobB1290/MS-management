import { ImageResponse } from "next/og"

export const size = { width: 192, height: 192 }
export const contentType = "image/png"

/**
 * Favicon / generic PWA icon. Generated at build time by Next.js so we
 * don't need a binary asset checked into the repo. Matches the brand:
 * warm cream background, gold "M" in Playfair Display.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#f6f1ea",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 130,
          fontFamily: "Georgia, serif",
          fontWeight: 600,
          color: "#9d7853",
          letterSpacing: "-0.04em",
          borderRadius: 38,
        }}
      >
        M
      </div>
    ),
    size,
  )
}
