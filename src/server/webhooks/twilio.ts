import crypto from "node:crypto"

/**
 * Verify the X-Twilio-Signature header against the request URL + sorted
 * form params. This is the *only* trust anchor for inbound messages — no
 * verification, no DB write.
 *
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(args: {
  authToken: string
  signatureHeader: string | null
  url: string // exact URL Twilio called (incl. https + path + query)
  params: Record<string, string>
}): boolean {
  const { authToken, signatureHeader, url, params } = args
  if (!signatureHeader) return false

  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("")

  const data = url + sorted
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64")

  // Constant-time compare
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
