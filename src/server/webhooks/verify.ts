import "server-only"
import crypto from "node:crypto"
import { verifyTwilioSignature } from "./twilio"

/**
 * Centralized webhook authentication. Each webhook route calls one of the
 * `verify*` helpers below — there is no per-route duplication of the
 * "verify or bypass" logic. The dev-bypass header is fenced behind THREE
 * conditions: NODE_ENV !== "production", ALLOW_WEBHOOK_BYPASS === "1", and
 * an exact header value. Removing any one closes the door.
 */
function devBypassEnabled(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false
  if (process.env.ALLOW_WEBHOOK_BYPASS !== "1") return false
  return request.headers.get("x-dev-bypass-signature") === "true"
}

/** Canonical URL Twilio actually called — never trust the request Host header. */
function canonicalWebhookUrl(path: string): string {
  const base = process.env.APP_BASE_URL
  if (!base) throw new Error("APP_BASE_URL is not configured")
  return `${base.replace(/\/$/, "")}${path}`
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number; reason: string }

export function verifyTwilioRequest(
  request: Request,
  pathname: string,
  params: Record<string, string>,
): VerifyResult {
  if (devBypassEnabled(request)) return { ok: true }

  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    return { ok: false, status: 503, reason: "Twilio not configured" }
  }
  const signature = request.headers.get("x-twilio-signature")
  let url: string
  try {
    url = canonicalWebhookUrl(pathname)
  } catch {
    return { ok: false, status: 503, reason: "APP_BASE_URL not configured" }
  }
  const valid = verifyTwilioSignature({
    authToken,
    signatureHeader: signature,
    url,
    params,
  })
  if (!valid) return { ok: false, status: 403, reason: "Invalid signature" }
  return { ok: true }
}

/**
 * Brevo does NOT cryptographically sign webhooks (unlike SendGrid's ECDSA Event
 * Webhook), so the marketing webhook is authenticated by a long shared secret
 * carried in the URL query string (`?token=…`). Configure the Brevo webhook
 * destination as `<APP_BASE_URL>/api/webhook/brevo?token=<BREVO_WEBHOOK_TOKEN>`.
 * Constant-time compare; an unset secret means the webhook is off (503).
 */
export function verifyBrevoWebhookToken(token: string | null): VerifyResult {
  const expected = process.env.BREVO_WEBHOOK_TOKEN
  if (!expected) {
    return { ok: false, status: 503, reason: "Brevo webhook not configured" }
  }
  if (!token) return { ok: false, status: 403, reason: "Missing token" }
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 403, reason: "Invalid token" }
  }
  return { ok: true }
}

/**
 * HMAC verification for the public-website form receiver. Now requires a
 * timestamp + nonce inside the signed body to block replay.
 */
export function verifyHmacRequest(
  request: Request,
  rawBody: string,
): VerifyResult {
  if (devBypassEnabled(request)) return { ok: true }

  const secret = process.env.PUBLIC_FORM_HMAC_SECRET
  if (!secret) {
    return { ok: false, status: 503, reason: "Form receiver not configured" }
  }
  const signature = request.headers.get("x-form-signature")
  if (!signature) return { ok: false, status: 403, reason: "Missing signature" }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 403, reason: "Invalid signature" }
  }
  return { ok: true }
}
