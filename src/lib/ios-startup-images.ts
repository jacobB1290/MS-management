/**
 * iOS launch screens (`apple-touch-startup-image`). When the installed web app
 * cold-launches in standalone mode, iOS paints the matching image during the
 * boot gap instead of a blank screen — the native launch-screen experience.
 *
 * iOS only shows the image whose media query matches the device EXACTLY, so we
 * enumerate the device classes. An unmatched device just falls back to today's
 * blank, so partial coverage is strictly an improvement. Portrait only — the
 * app is orientation-locked. Each tuple is [cssWidth, cssHeight, dpr]; the href
 * carries the real pixel size so the generated image fills the screen with no
 * letterboxing.
 */
const DEVICES: ReadonlyArray<readonly [number, number, number]> = [
  // iPhones
  [375, 667, 2], // SE (2nd/3rd gen), 8, 7, 6s
  [375, 812, 3], // X, XS, 11 Pro
  [360, 780, 3], // 12 mini, 13 mini
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [402, 874, 3], // 16 Pro
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus, 15 Plus
  [430, 932, 3], // 15 Pro Max, 16 Plus
  [440, 956, 3], // 16 Pro Max
  // iPads
  [744, 1133, 2], // iPad mini (6th gen)
  [768, 1024, 2], // iPad 9.7", mini (older)
  [810, 1080, 2], // iPad 10.2"
  [820, 1180, 2], // iPad Air 10.9", iPad 10th gen
  [834, 1112, 2], // iPad Pro 10.5", Air (3rd gen)
  [834, 1194, 2], // iPad Pro 11"
  [1024, 1366, 2], // iPad Pro 12.9"
]

export interface StartupImage {
  rel: "apple-touch-startup-image"
  url: string
  media: string
}

export const IOS_STARTUP_IMAGES: StartupImage[] = DEVICES.map(([w, h, dpr]) => ({
  rel: "apple-touch-startup-image",
  url: `/startup-image?w=${w * dpr}&h=${h * dpr}`,
  media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}))
