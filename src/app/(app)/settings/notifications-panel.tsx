"use client"
import { useEffect, useState } from "react"
import { Bell, BellOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  isPushSupported,
  isSubscribed,
  enablePush,
  disablePush,
  notificationPermission,
  VAPID_PUBLIC_KEY,
} from "@/lib/push/client"

type State = "loading" | "unsupported" | "unconfigured" | "blocked" | "off" | "on"

export function NotificationsPanel() {
  const [state, setState] = useState<State>("loading")
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      if (!VAPID_PUBLIC_KEY) return active && setState("unconfigured")
      if (!isPushSupported()) return active && setState("unsupported")
      if (notificationPermission() === "denied") return active && setState("blocked")
      const subbed = await isSubscribed()
      if (active) setState(subbed ? "on" : "off")
    })()
    return () => {
      active = false
    }
  }, [])

  async function enable() {
    setWorking(true)
    const result = await enablePush()
    setWorking(false)
    if (result === "subscribed") {
      setState("on")
      toast.success("Notifications enabled on this device")
    } else if (result === "denied") {
      setState("blocked")
      toast.error("Notifications were blocked. Enable them in your browser settings")
    } else if (result === "unsupported") {
      setState("unsupported")
    } else if (result === "no-key") {
      setState("unconfigured")
    } else {
      toast.error("Couldn’t enable notifications. Try again")
    }
  }

  async function disable() {
    setWorking(true)
    await disablePush()
    setWorking(false)
    setState("off")
    toast.success("Notifications disabled on this device")
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-gold">
        {state === "on" ? <Bell size={18} /> : <BellOff size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body text-ink font-medium">Push notifications</p>
        <p className="text-small text-ink-muted leading-prose mt-0.5">
          {state === "on"
            ? "This device will alert you when a new message arrives, even when the app is closed."
            : "Get alerted on this device when a new message arrives, even when the app is closed."}
        </p>

        <div className="mt-3">
          {state === "loading" && (
            <p className="text-small text-ink-faint">Checking…</p>
          )}
          {state === "unsupported" && (
            <p className="text-small text-ink-faint">
              This browser doesn’t support push notifications. On iPhone, add the
              app to your Home Screen first, then enable them here.
            </p>
          )}
          {state === "unconfigured" && (
            <p className="text-small text-ink-faint">
              Push isn’t configured for this deployment yet (missing VAPID key).
            </p>
          )}
          {state === "blocked" && (
            <p className="text-small text-danger">
              Notifications are blocked for this site. Re-enable them in your
              browser or system settings, then reload.
            </p>
          )}
          {state === "off" && (
            <Button size="sm" onClick={enable} disabled={working}>
              {working ? "Enabling…" : "Enable on this device"}
            </Button>
          )}
          {state === "on" && (
            <Button variant="secondary" size="sm" onClick={disable} disabled={working}>
              {working ? "Disabling…" : "Disable on this device"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
