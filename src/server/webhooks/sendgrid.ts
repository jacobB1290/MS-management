import crypto from "node:crypto"

/**
 * Verify a SendGrid Event Webhook signature. SendGrid signs
 * `(timestamp + body)` with ECDSA P-256 using its private key; we verify
 * with the public key from the dashboard.
 *
 * https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
export function verifySendGridSignature(args: {
  publicKey: string // PEM-encoded ECDSA public key from dashboard
  signature: string | null // X-Twilio-Email-Event-Webhook-Signature
  timestamp: string | null // X-Twilio-Email-Event-Webhook-Timestamp
  rawBody: string // exact bytes of the request body
}): boolean {
  const { publicKey, signature, timestamp, rawBody } = args
  if (!signature || !timestamp) return false

  try {
    const verify = crypto.createVerify("SHA256")
    verify.update(timestamp + rawBody)
    verify.end()
    const sigBuf = Buffer.from(signature, "base64")
    return verify.verify(
      { key: publicKey, dsaEncoding: "der" },
      sigBuf,
    )
  } catch {
    return false
  }
}
