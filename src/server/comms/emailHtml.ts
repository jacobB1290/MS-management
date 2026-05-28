import "server-only"
import sanitizeHtml from "sanitize-html"
import { signUnsubscribe } from "./emailAddress"

/**
 * Email HTML pipeline for 1:1 transactional email. Two responsibilities, kept
 * separate so each can be reused independently:
 *
 *   1. `sanitizeEmailContent` — a STRICT allowlist sanitizer for the *content*
 *      fragment (the body the operator wrote or the AI produced). This is the
 *      security wall (CLAUDE.md §5): it runs before the HTML is ever rendered
 *      in the composer preview AND again in the send path before wrapping, so
 *      a stale or tampered payload can never inject script/style/handlers.
 *   2. `wrapBrandedEmail` — wraps the sanitized content fragment in the Morning
 *      Star Christian Church template (header + footer with the physical
 *      mailing address and a working unsubscribe link). Inline CSS + table
 *      layout for email-client safety; Playfair is not email-safe, so the
 *      display face degrades to Georgia/serif.
 *
 * The content fragment is NEVER a full document — only the inner semantic tags.
 * The template owns <html>/<head>/<body>.
 */

// --- Allowlist sanitizer -----------------------------------------------------

/** Tags allowed in the email content fragment. Intentionally narrow. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "h2",
  "h3",
  "blockquote",
] as const

/**
 * Sanitize an email content fragment against a strict allowlist. Strips
 * scripts, styles, event handlers, and any tag/attribute not explicitly
 * allowed. The only attribute permitted is `href` on `<a>`, and only with an
 * http/https/mailto scheme. `<b>`/`<i>` are normalized to `<strong>`/`<em>`.
 */
export function sanitizeEmailContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    // Force links to open in a new tab and not leak the referrer / window.
    transformTags: {
      b: "strong",
      i: "em",
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
    // Drop the contents of anything disallowed (e.g. <script>, <style>).
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
    disallowedTagsMode: "discard",
  }).trim()
}

// --- Branded template --------------------------------------------------------

const GOLD = "#9d7853"
const GOLD_DARK = "#7c5d40"
const BG = "#f7f3ec"
const SURFACE = "#fffdf9"
const INK = "#2b2b2b"
const INK_MUTED = "#6b6256"
const HAIRLINE = "#e7ddcd"

const CHURCH_NAME = "Morning Star Christian Church"

function physicalAddress(): string {
  return process.env.PHYSICAL_MAILING_ADDRESS?.trim() || "3080 N Wildwood St, Boise, ID 83713"
}

/** The signed unsubscribe URL for the footer, or null when no secret/base set. */
function unsubscribeUrl(contactId: string): string | null {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "")
  const sig = signUnsubscribe(contactId)
  if (!base || !sig) return null
  return `${base}/api/email/unsubscribe?c=${contactId}&t=${sig}`
}

/**
 * Wrap a sanitized content fragment in the branded church template. The caller
 * MUST pass already-sanitized HTML (the send path sanitizes first). Returns a
 * complete email document (table layout, inline CSS) safe for email clients.
 */
export function wrapBrandedEmail(args: {
  contentHtml: string
  contactId: string
}): string {
  const address = physicalAddress()
  const unsubUrl = unsubscribeUrl(args.contactId)
  const unsubLine = unsubUrl
    ? `<a href="${unsubUrl}" style="color:${GOLD_DARK};text-decoration:underline;">Unsubscribe</a> from these emails.`
    : "Reply with the word unsubscribe to stop receiving email."

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${CHURCH_NAME}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:${SURFACE};border:1px solid ${HAIRLINE};border-radius:14px;overflow:hidden;">
<tr>
<td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${HAIRLINE};">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.2;color:${GOLD};font-weight:700;">${CHURCH_NAME}</div>
</td>
</tr>
<tr>
<td style="padding:28px 32px 32px 32px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${INK};">
${args.contentHtml}
</td>
</tr>
<tr>
<td style="padding:20px 32px 28px 32px;border-top:1px solid ${HAIRLINE};font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${INK_MUTED};">
<div style="margin:0 0 6px 0;">${CHURCH_NAME}</div>
<div style="margin:0 0 10px 0;">${address}</div>
<div style="margin:0;">${unsubLine}</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}
