import "server-only"
import sanitizeHtml from "sanitize-html"

/**
 * Email HTML pipeline for 1:1 transactional email. The guiding principle: a
 * personal reply from this CRM should read like a real person sat down and
 * wrote it — NOT like a branded marketing template. So there is deliberately no
 * masthead, monogram, or corporate footer here. The "craft" lives in the
 * humanity: a warm sign-off with the sender's name, curly typography, a clean
 * single column, and the absence of bulk-mail chrome (no List-Unsubscribe
 * banner — see `sendDirectEmail`). Three responsibilities, kept separate:
 *
 *   1. `sanitizeEmailContent` — a STRICT allowlist sanitizer for the *content*
 *      fragment (what the operator wrote or the AI produced). The security wall
 *      (CLAUDE.md §5): it runs before the HTML is ever rendered in the composer
 *      preview AND again before send, so a stale/tampered payload can never
 *      inject script/style/handlers. It also smart-quotes prose text.
 *   2. `wrapPersonalEmail` — wraps the sanitized fragment in a minimal, personal
 *      shell (single column, system font, a human sign-off). Email-safe inline
 *      CSS + table layout + Outlook/dark-mode hardening.
 *   3. `htmlFragmentToText` — renders the fragment to plain text for the
 *      multipart text/plain part and to seed the composer body.
 *
 * The content fragment is NEVER a full document — only the inner semantic tags.
 * The shell owns <html>/<head>/<body>.
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
 * Convert straight quotes/apostrophes to curly ones (CLAUDE.md §7: visible copy
 * uses U+2018/U+2019/U+201C/U+201D). Operates on a plain run of text — opening
 * vs closing is decided by the preceding character. Applied to HTML text nodes
 * (via the sanitizer's textFilter) and to the plain-text body, so both parts of
 * the email get the same typographic polish.
 */
export function toSmartQuotes(text: string): string {
  return text
    .replace(/(^|[\s([{<–—\-])"/g, "$1“") // opening "
    .replace(/"/g, "”") // closing "
    .replace(/(^|[\s([{<–—\-])'/g, "$1‘") // opening '
    .replace(/'/g, "’") // closing ' / apostrophe
}

/**
 * Sanitize an email content fragment against a strict allowlist. Strips
 * scripts, styles, event handlers, and any tag/attribute not explicitly
 * allowed. The only attribute permitted is `href` on `<a>`, and only with an
 * http/https/mailto scheme. `<b>`/`<i>` are normalized to `<strong>`/`<em>`.
 * Prose text is smart-quoted on the way through.
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
    // Smart-quote the visible text. textFilter only ever sees text nodes, never
    // tag names or attribute values, so this can't corrupt an href.
    textFilter: (text) => toSmartQuotes(text),
    // Drop the contents of anything disallowed (e.g. <script>, <style>).
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
    disallowedTagsMode: "discard",
  }).trim()
}

/**
 * Render a sanitized email content fragment down to readable plain text. Used
 * to seed the composer's plain-text body after an AI draft so the multipart
 * email's `text/plain` part stays in sync with the rich `text/html` part. Block
 * tags become line breaks, list items get a bullet, the rest is stripped and
 * entity-decoded. Input is expected to already be allowlist-sanitized.
 */
export function htmlFragmentToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(p|h2|h3|blockquote|ul|ol|li)\s*>/gi, "\n\n")
  const noTags = withBreaks.replace(/<[^>]+>/g, "")
  const decoded = noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
  return decoded
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Turn an operator's plain-text reply into a safe semantic fragment (smart
 * quotes, blank-line paragraphs, single newlines as <br>). Used to render a
 * faithful PREVIEW of a plain typed reply in the personal shell — the real send
 * stays text/plain, but this shows the operator the message + sign-off as it
 * will read. Output is escaped, so it's safe to wrap and render.
 */
export function plainTextToContentHtml(text: string): string {
  return toSmartQuotes(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n")
}

// --- Personal email shell ----------------------------------------------------

// Brand tokens, flattened to email-safe solid hex (email clients mishandle the
// site's rgba() text scale). Matched to the canonical ms.church values.
const GOLD_DARK = "#6e5239"
const GOLD_ACCENT = "#9d7853"
const INK = "#1f1a14"

const CHURCH_NAME = "Morning Star Christian Church"

/** System font stack — renders in the recipient's native UI font, so the note
 *  reads like a normal personal email rather than a designed template. */
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Inline email-safe styling onto the bare allowed tags. The sanitizer strips
 * every attribute (except href on <a>), so each opening tag is bare and a
 * targeted replace is safe — this gives consistent paragraph rhythm and on-brand
 * gold links even in clients (Gmail) that ignore <style> blocks.
 */
function styleContentForEmail(html: string): string {
  return html
    .replace(/<p>/gi, `<p style="margin:0 0 16px;">`)
    .replace(
      /<h2>/gi,
      `<h2 style="margin:24px 0 8px;font-size:19px;font-weight:600;color:${INK};line-height:1.35;">`,
    )
    .replace(
      /<h3>/gi,
      `<h3 style="margin:20px 0 6px;font-size:16px;font-weight:600;color:${INK};line-height:1.4;">`,
    )
    .replace(/<ul>/gi, `<ul style="margin:0 0 16px;padding-left:22px;">`)
    .replace(/<ol>/gi, `<ol style="margin:0 0 16px;padding-left:22px;">`)
    .replace(/<li>/gi, `<li style="margin:0 0 6px;">`)
    .replace(
      /<blockquote>/gi,
      `<blockquote style="margin:0 0 16px;padding-left:14px;border-left:2px solid ${GOLD_ACCENT};color:${GOLD_DARK};font-style:italic;">`,
    )
    .replace(/<a /gi, `<a style="color:${GOLD_DARK};text-decoration:underline;" `)
}

/**
 * The warm human sign-off. A real person closes with their name; the church
 * name sits quietly beneath in gold — identity without a masthead. Falls back to
 * signing as the church when no sender name is known.
 */
export function personalSignatureText(senderName: string | null): string {
  const name = senderName?.trim()
  return name
    ? `Warmly,\n${name}\n${CHURCH_NAME}`
    : `Warmly,\n${CHURCH_NAME}`
}

function signatureHtml(senderName: string | null): string {
  const name = senderName?.trim()
  const church = `<div style="margin-top:2px;font-size:14px;color:${GOLD_DARK};">${CHURCH_NAME}</div>`
  const nameLine = name ? `<div style="margin-top:2px;">${escapeHtml(name)}</div>` : ""
  return `<div style="margin:28px 0 0;font-size:16px;line-height:1.6;color:${INK};">
<div>Warmly,</div>${nameLine}
${church}
</div>`
}

/** Hidden preheader: controls the inbox preview line so it's the warm opening
 *  sentence, not a scraped fragment. Padded so the client doesn't pull body
 *  text in after it. */
function preheaderBlock(preheader: string): string {
  const text = escapeHtml(preheader.trim()).slice(0, 140)
  const pad = "&#847;&zwnj;&nbsp;".repeat(20)
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">${text}${pad}</div>`
}

/**
 * Wrap a sanitized content fragment in the personal email shell. The caller MUST
 * pass already-sanitized HTML (the send path sanitizes first). Returns a
 * complete email document — minimal single column, system font, a warm sign-off
 * — hardened for Outlook (MSO ghost wrapper + PixelsPerInch) and dark mode
 * (light-locked, with the iOS data-detector recolor disabled).
 */
export function wrapPersonalEmail(args: {
  contentHtml: string
  preheader: string
  senderName: string | null
  lang?: string
}): string {
  const lang = args.lang === "ru" ? "ru" : "en"
  const content = styleContentForEmail(args.contentHtml)
  const signature = signatureHtml(args.senderName)
  const preheader = preheaderBlock(args.preheader)

  return `<!doctype html>
<html lang="${lang}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${CHURCH_NAME}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  a { color: ${GOLD_DARK}; }
  a[x-apple-data-detectors] {
    color: inherit !important; text-decoration: none !important;
    font-size: inherit !important; font-family: inherit !important;
    font-weight: inherit !important; line-height: inherit !important;
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;">
<tr>
<td align="center" style="padding:32px 20px;">
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr>
<td style="font-family:${FONT_STACK};font-size:16px;line-height:1.65;color:${INK};">
${content}
${signature}
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}
