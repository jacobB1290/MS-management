import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake the barrel imports on routes that pull single icons / date
    // helpers — drops the first-load JS noticeably on inbox + contacts.
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
}

export default nextConfig
