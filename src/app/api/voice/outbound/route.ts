import { NextResponse, type NextRequest } from "next/server"
import { verifyTwilioRequest } from "@/server/webhooks/verify"
import { buildOutboundDialTwiml, buildRejectTwiml } from "@/server/comms/voice"
import { toE164 } from "@/server/validation/phone"

/**
 * TwiML voice webhook for outbound browser calls. Configure this URL as the
 * Voice request URL (HTTP POST) on the Twilio TwiML App referenced by
 * TWILIO_TWIML_APP_SID:
 *   https://<host>/api/voice/outbound
 *
 * Trust model: the X-Twilio-Signature is verified against APP_BASE_URL +
 * pathname + sorted params, exactly like the inbound-SMS webhook. No valid
 * signature, no <Dial>. The destination arrives as the `To` param the browser
 * client passed to `device.connect`; we re-normalize it to E.164 and refuse
 * anything that doesn't parse rather than dial a bad number.
 */
const xmlResponse = (twiml: string, status = 200) =>
  new NextResponse(twiml, {
    status,
    headers: { "Content-Type": "text/xml" },
  })

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v

  const verify = verifyTwilioRequest(request, request.nextUrl.pathname, params)
  if (!verify.ok) return new NextResponse(verify.reason, { status: verify.status })

  const callerId = process.env.TWILIO_PHONE_NUMBER
  if (!callerId) {
    // No church number to present — reject rather than leak a default.
    return xmlResponse(buildRejectTwiml())
  }

  const to = toE164(params.To ?? "")
  if (!to) {
    return xmlResponse(buildRejectTwiml())
  }

  return xmlResponse(buildOutboundDialTwiml({ to, callerId }))
}
