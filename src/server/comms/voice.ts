import "server-only"
import crypto from "node:crypto"

/**
 * Browser-based outbound voice calling, server side. The operator UI never
 * sees the Twilio API secret — it asks this layer for a short-lived Voice
 * AccessToken, then the @twilio/voice-sdk `Device` in the browser uses that
 * token to place the call. Twilio dials the contact via the TwiML App, whose
 * Voice request URL points at `/api/voice/outbound`.
 *
 * Mirrors the raw-crypto, no-SDK pattern in `sendSms.ts` and
 * `billing/twilio.ts`: we mint the JWT ourselves rather than pull the heavy
 * `twilio` Node SDK into the server bundle.
 *
 * Voice is deliberately separate from SMS opt-out — `sms_opted_out_at` does
 * not gate a phone call. The only hard requirement is a phone on file.
 */

export interface VoiceConfig {
  accountSid: string
  apiKey: string
  apiSecret: string
  twimlAppSid: string
}

/**
 * Returns the full set of voice credentials, or null when any piece is
 * missing. Used by the token endpoint (to mint) and by `isVoiceConfigured`
 * (to expose a boolean to the UI without leaking the values).
 */
export function getVoiceConfig(): VoiceConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID
  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) return null
  return { accountSid, apiKey, apiSecret, twimlAppSid }
}

/** True when browser voice calling can be offered. Never leaks the secrets. */
export function isVoiceConfigured(): boolean {
  return getVoiceConfig() !== null
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * Mint a Twilio Voice AccessToken (JWT, HS256 signed with the API secret).
 *
 * Shape per Twilio's spec:
 *   header:  { cty: "twilio-fpa;v=1", typ: "JWT", alg: "HS256" }
 *   payload: { jti, iss: <API key SID>, sub: <account SID>, nbf, exp,
 *              grants: { identity, voice: { outgoing: { application_sid } } } }
 *
 * Outgoing-only by design (no `incoming` grant) and short-lived — the token
 * only needs to survive registering the Device and placing one call.
 *
 * https://www.twilio.com/docs/iam/access-tokens
 */
export function mintVoiceAccessToken(args: {
  config: VoiceConfig
  identity: string
  ttlSeconds?: number
}): { token: string; identity: string; expiresAt: string } {
  const { config, identity } = args
  const ttl = args.ttlSeconds ?? 120
  const nowSeconds = Math.floor(Date.now() / 1000)
  const exp = nowSeconds + ttl

  const header = {
    cty: "twilio-fpa;v=1",
    typ: "JWT",
    alg: "HS256",
  }

  const payload = {
    jti: `${config.apiKey}-${crypto.randomUUID()}`,
    iss: config.apiKey,
    sub: config.accountSid,
    nbf: nowSeconds,
    exp,
    grants: {
      identity,
      voice: {
        outgoing: { application_sid: config.twimlAppSid },
      },
    },
  }

  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = base64url(
    crypto.createHmac("sha256", config.apiSecret).update(signingInput).digest(),
  )

  return {
    token: `${signingInput}.${signature}`,
    identity,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

/**
 * The TwiML returned to Twilio when the browser client places an outbound
 * call. Dials the contact's E.164 number, presenting the church's number as
 * the caller ID. `to` is the validated destination from the call params.
 */
export function buildOutboundDialTwiml(args: {
  to: string
  callerId: string
}): string {
  const to = escapeXml(args.to)
  const callerId = escapeXml(args.callerId)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Dial callerId="${callerId}"><Number>${to}</Number></Dial></Response>`
  )
}

/** A bare hang-up response, used when the destination is missing/invalid. */
export function buildRejectTwiml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Reject reason="rejected"/></Response>`
  )
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
