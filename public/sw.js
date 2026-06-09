/* Service worker for web push notifications + a static-asset cache.
 *
 * Caching is deliberately limited to content-hashed build assets and font
 * files — things that are immutable by URL — so a standalone cold launch
 * paints from disk instead of re-downloading the bundle every time. HTML,
 * RSC payloads, and API responses are NEVER intercepted: freshness there is
 * owned by the app (LiveRefresh / StaleReload), and a stale-shell bug class
 * is not worth the extra bytes. */

const STATIC_CACHE = "ms-static-v1"

self.addEventListener("install", () => {
  // Activate immediately so a freshly registered SW can receive pushes.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older SW versions.
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k.startsWith("ms-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Immutable-by-URL requests it is safe to serve cache-first, forever:
 *  content-hashed Next build assets and font binaries/stylesheets. */
function isCacheableStatic(url) {
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith("/_next/static/")
  }
  return url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com"
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (!isCacheableStatic(url)) return // fall through to the network untouched

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      if (response.ok && (response.type === "basic" || response.type === "cors")) {
        cache.put(request, response.clone())
      }
      return response
    })(),
  )
})

self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : "" }
  }

  const title = payload.title || "Morning Star"
  const options = {
    body: payload.body || "",
    icon: "/icon",
    badge: "/icon",
    // Same tag collapses repeat notifications from one conversation; renotify
    // still alerts on each new one.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/inbox" },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/inbox"

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl)
            } catch {
              /* cross-origin or not allowed — focus is enough */
            }
          }
          return
        }
      }
      await self.clients.openWindow(targetUrl)
    })(),
  )
})
