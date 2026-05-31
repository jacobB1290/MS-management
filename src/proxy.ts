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
     * - the generated brand art: the app icons and the iOS launch screens
     *   (apple-touch-startup-image). These are non-sensitive and iOS fetches
     *   them at install / cold-launch, sometimes without the session cookie —
     *   so they must serve the image, not a /login redirect (which would leave
     *   the launch screen blank).
     * - favicon and other static public files
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon|apple-icon|startup-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|js|webmanifest)$).*)",
  ],
}
