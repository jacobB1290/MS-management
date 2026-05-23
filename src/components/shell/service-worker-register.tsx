"use client"
import { useEffect } from "react"
import { isPushSupported, registerServiceWorker, VAPID_PUBLIC_KEY } from "@/lib/push/client"

/** Registers the push service worker on load so already-subscribed devices
 *  keep receiving notifications. No-op when push isn't supported or VAPID
 *  isn't configured. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !isPushSupported()) return
    void registerServiceWorker()
  }, [])
  return null
}
