/* Service worker for web push notifications.
 * Kept minimal and push-only: it does not cache or intercept fetches. */

self.addEventListener("install", () => {
  // Activate immediately so a freshly registered SW can receive pushes.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
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
