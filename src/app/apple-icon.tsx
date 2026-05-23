import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

/**
 * iOS apple-touch-icon. Required for Safari to recognize the site as
 * PWA-capable when added to home screen. Without this, the standalone
 * mode meta tag is ignored and Safari chrome stays visible.
 *
 * No rounded corners — iOS applies its own mask.
 */
export default function AppleIcon() {
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
          fontSize: 122,
          fontFamily: "Georgia, serif",
          fontWeight: 600,
          color: "#9d7853",
          letterSpacing: "-0.04em",
        }}
      >
        M
      </div>
    ),
    size,
  )
}
