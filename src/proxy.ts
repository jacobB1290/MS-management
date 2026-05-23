import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (build assets)
     * - _next/image (image optimization)
     * - the service worker + PWA manifest (must be publicly fetchable, not
     *   redirected to /login)
     * - favicon and other static public files
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|js|webmanifest)$).*)",
  ],
}
