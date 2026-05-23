/**
 * Brand design tokens — single source of truth.
 *
 * Mirrors the ms.church `website-V2` token system so the public site and this
 * internal CRM read as one product family. The same tokens are exposed as CSS
 * custom properties in `src/app/globals.css`; this TS file is the typed view
 * for cases where we need a token value in component logic (Tailwind class
 * composition, inline style props, motion config, etc.).
 *
 * If you want to add or change a token, change it in BOTH places (this file
 * and `globals.css`) and reference it everywhere via the variable name — never
 * inline a raw hex/px/clamp value.
 */

export const colors = {
  gold: "#9d7853",
  goldDark: "#6e5239",
  goldDeeper: "#4d3826",
  bg: "#f6f1ea",
  surface: "#fbf7f1",
  white: "#ffffff",
  ink: "#1f1a14",
  inkSoft: "rgba(31, 26, 20, 0.85)",
  inkMuted: "rgba(31, 26, 20, 0.72)",
  inkFaint: "rgba(31, 26, 20, 0.55)",
  inkFade: "rgba(31, 26, 20, 0.30)",
  inkHairline: "rgba(31, 26, 20, 0.10)",
  red: "#a8413a",
  redDark: "#6e2c27",
  success: "#3f7a52",
  warning: "#b07a2a",
  danger: "#a8413a",
} as const

export const fonts = {
  display: '"Playfair Display", "Times New Roman", serif',
  body: '"Inter", "Helvetica Neue", Arial, sans-serif',
} as const

export const radius = {
  sm: "8px",
  md: "16px",
  lg: "22px",
  xl: "26px",
  "2xl": "40px",
  pill: "999px",
  circle: "50%",
} as const

export const motion = {
  fast: "0.2s",
  medium: "0.3s",
  slow: "0.6s",
  easeStandard: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeOutSoft: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const

export const breakpoints = {
  mobileMax: 960,
  desktopMin: 961,
} as const

export type ContactRole = "admin" | "member"
