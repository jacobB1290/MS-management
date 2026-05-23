"use client"

/** Browser-side web-push helpers: feature detection, SW registration, and
 *  subscribe/unsubscribe that sync the PushSubscription to our server. */

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported"
  return Notification.permission
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const output = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" })
  } catch {
    return null
  }
}

/** True if this browser already has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  return Boolean(sub)
}

/**
 * Request permission (if needed), subscribe via PushManager, and persist the
 * subscription server-side. Returns the resulting permission/outcome.
 */
export async function enablePush(): Promise<
  "subscribed" | "denied" | "unsupported" | "no-key" | "error"
> {
  if (!isPushSupported()) return "unsupported"
  if (!VAPID_PUBLIC_KEY) return "no-key"

  const permission = await Notification.requestPermission()
  if (permission !== "granted") return "denied"

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  if (!reg) return "error"
  await navigator.serviceWorker.ready

  try {
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const json = sub.toJSON()
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: json.keys,
        user_agent: navigator.userAgent,
      }),
    })
    if (!res.ok) return "error"
    return "subscribed"
  } catch {
    return "error"
  }
}

/** Unsubscribe this browser and drop the server-side record. */
export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return true
  const endpoint = sub.endpoint
  try {
    await sub.unsubscribe()
  } catch {
    /* ignore — still drop server-side */
  }
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {})
  return true
}
