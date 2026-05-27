import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake the barrel imports on routes that pull single icons / date
    // helpers — drops the first-load JS noticeably on inbox + contacts.
    optimizePackageImports: ["lucide-react", "date-fns"],
    // Keep recently-visited routes in the client router cache so going back to
    // a thread/list/contact you just saw is instant instead of a fresh server
    // fetch every time. LiveRefresh + the inbox subscriptions keep the cached
    // view honest, so a short stale window is invisible in practice.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // The visual harness boots `next dev` with DEMO_MODE=1. Hide the dev overlay
  // there so its transient "Compiling…" indicator can't land in a screenshot
  // and flake the pixel diff. Normal local dev (no DEMO_MODE) keeps it.
  ...(process.env.DEMO_MODE === "1" ? { devIndicators: false as const } : {}),
}

export default nextConfig
