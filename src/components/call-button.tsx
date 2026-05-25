"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { Phone, PhoneOff, Mic, MicOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { Call, Device } from "@twilio/voice-sdk"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { formatPhone, cn } from "@/lib/utils"

type CallState =
  | "idle"
  | "connecting" // fetching token + registering device
  | "ringing" // dialing the contact
  | "in-call"
  | "ending"

interface CallButtonProps {
  contactId: string
  /** E.164 phone, or null when none is on file. */
  phone: string | null
  contactName?: string | null
  /** Whether the Twilio Voice env is fully configured (server-checked). */
  voiceConfigured: boolean
  /** Visual style: icon-only (panel header) is the default. */
  variant?: "icon" | "secondary"
  className?: string
}

/**
 * Browser-based outbound calling. Tapping the button fetches a short-lived
 * Twilio Voice AccessToken from `/api/voice/token`, spins up a `Device` from
 * @twilio/voice-sdk, and dials the contact through our TwiML App (which dials
 * out from the church number). Mute + hang up live in the in-call dialog.
 *
 * Degrades gracefully:
 *  - No phone on file → the button does not render at all.
 *  - Voice not configured on the server → disabled button with a tooltip.
 *
 * The SDK is imported lazily so its weight never lands in the initial bundle;
 * it only loads the first time an operator actually starts a call.
 */
export function CallButton({
  contactId,
  phone,
  contactName,
  voiceConfigured,
  variant = "icon",
  className,
}: CallButtonProps) {
  const [state, setState] = useState<CallState>("idle")
  const [muted, setMuted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const active = state !== "idle"

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** Tear down the call + device and reset all local state. */
  const teardown = useCallback(() => {
    stopTimer()
    const call = callRef.current
    const device = deviceRef.current
    callRef.current = null
    deviceRef.current = null
    try {
      call?.disconnect()
    } catch {
      /* already gone */
    }
    try {
      device?.destroy()
    } catch {
      /* already gone */
    }
    setState("idle")
    setMuted(false)
    setSeconds(0)
  }, [stopTimer])

  // Safety net: destroy the device if the component unmounts mid-call (e.g.
  // the operator navigates to another contact while connected).
  useEffect(() => {
    return () => {
      try {
        callRef.current?.disconnect()
        deviceRef.current?.destroy()
      } catch {
        /* noop */
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  async function startCall() {
    if (!phone || active) return
    setState("connecting")
    try {
      const res = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        const reason =
          j?.error === "voice_not_configured"
            ? "Voice calling is not set up yet"
            : j?.error === "no_phone"
              ? "No phone number on file"
              : `Could not start call: ${j?.error ?? res.status}`
        toast.error(reason)
        setState("idle")
        return
      }
      const data = (await res.json()) as { token: string; to: string }

      // Lazy-load the SDK only now, on first real use.
      const { Device } = await import("@twilio/voice-sdk")

      if (!Device.isSupported) {
        toast.error("This browser can’t place calls. Try Chrome or Safari")
        setState("idle")
        return
      }

      const device = new Device(data.token, { logLevel: "error" })
      deviceRef.current = device

      device.on("error", (err: { message?: string }) => {
        toast.error(`Call error: ${err?.message ?? "unknown"}`)
        teardown()
      })

      await device.register()

      const call = await device.connect({ params: { To: data.to } })
      callRef.current = call
      setState("ringing")

      call.on("accept", () => {
        setState("in-call")
        setSeconds(0)
        stopTimer()
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      })
      call.on("disconnect", () => teardown())
      call.on("cancel", () => teardown())
      call.on("reject", () => teardown())
      call.on("error", (err: { message?: string }) => {
        toast.error(`Call error: ${err?.message ?? "unknown"}`)
        teardown()
      })
    } catch (err) {
      toast.error(`Could not start call: ${err instanceof Error ? err.message : String(err)}`)
      teardown()
    }
  }

  function toggleMute() {
    const call = callRef.current
    if (!call) return
    const next = !muted
    call.mute(next)
    setMuted(next)
  }

  function hangUp() {
    setState("ending")
    teardown()
  }

  // No phone → no affordance at all.
  if (!phone) return null

  // Voice not configured on the server → disabled button + explainer.
  if (!voiceConfigured) {
    return (
      <Tooltip content="Voice calling not set up yet">
        {variant === "icon" ? (
          <button
            type="button"
            disabled
            aria-label="Call (not available)"
            className="btn-icon-action opacity-50 cursor-not-allowed"
          >
            <Phone size={18} />
          </button>
        ) : (
          <Button variant="secondary" disabled className={className}>
            <Phone size={14} />
            Call
          </Button>
        )}
      </Tooltip>
    )
  }

  return (
    <>
      {variant === "icon" ? (
        <Tooltip content="Call this contact">
          <button
            type="button"
            onClick={startCall}
            disabled={active}
            aria-label="Call this contact"
            className={cn("btn-icon-action", className)}
          >
            <Phone size={18} />
          </button>
        </Tooltip>
      ) : (
        <Button
          variant="secondary"
          onClick={startCall}
          disabled={active}
          className={className}
        >
          <Phone size={14} />
          Call
        </Button>
      )}

      <Dialog
        open={active}
        onOpenChange={(next) => {
          // The dialog can only be dismissed by hanging up — closing it ends
          // the call so we never leave a live mic running in the background.
          if (!next) hangUp()
        }}
      >
        <DialogContent showCloseButton={false} className="items-center text-center">
          <DialogHeader className="items-center">
            <DialogTitle>{contactName?.trim() || formatPhone(phone)}</DialogTitle>
            <DialogDescription>
              {state === "connecting"
                ? "Connecting…"
                : state === "ringing"
                  ? "Ringing…"
                  : state === "ending"
                    ? "Ending call…"
                    : formatDuration(seconds)}
            </DialogDescription>
          </DialogHeader>

          <p className="text-small text-ink-faint -mt-1">{formatPhone(phone)}</p>

          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={toggleMute}
              disabled={state !== "in-call"}
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              className={cn(
                "inline-flex items-center justify-center h-12 w-12 rounded-pill border transition-colors disabled:opacity-40",
                muted
                  ? "bg-ink text-white border-ink"
                  : "bg-white text-ink border-ink-hairline hover:bg-bg",
              )}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <button
              type="button"
              onClick={hangUp}
              aria-label="Hang up"
              className="inline-flex items-center justify-center h-14 w-14 rounded-pill bg-danger text-white shadow-[var(--shadow-md)] transition-transform hover:scale-105 active:scale-95"
            >
              {state === "connecting" || state === "ending" ? (
                <Loader2 size={22} className="animate-spin" />
              ) : (
                <PhoneOff size={22} />
              )}
            </button>

            {/* Spacer to keep the hang-up button visually centered. */}
            <span className="h-12 w-12" aria-hidden />
          </div>

          <p className="mt-1 text-micro text-ink-faint">
            {muted ? "You’re muted" : "Calling from the church number"}
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}
