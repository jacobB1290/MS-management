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

// Palette taken from the public ms.church site: cool dark-navy ink for serif
// headlines + the wordmark, warm gold for emphasis / eyebrows / links, on a warm
// cream ground. (Email-safe solid hex; clients mishandle rgba.)
const GOLD = "#9d7853" // eyebrows, links, italic emphasis
const GOLD_DARK = "#6e5239" // link/emphasis on light, slightly deeper
const INK = "#1c2230" // navy-charcoal: wordmark + serif headings (the site's H-ink)
const INK_SOFT = "#343b46" // slate: body prose
const MUTED = "#8d909a" // cool grey: wordmark subline, quiet labels
const FAINT = "#9a9388" // warm grey: dateline / footer
const BG = "#f5f2ec" // warm cream page
const HAIRLINE = "#e4ddcf" // thin section rules

// Middot separator for tracked-caps lines (the site's "WORSHIP · KIDS ·" device).
const MIDDOT = "&middot;"

const CHURCH_NAME = "Morning Star Christian Church"

/** Display face for the letterhead, greeting, and sign-off. Playfair loads on
 *  Apple Mail / iOS (where most of our staff + recipients read) via the head
 *  @import; everywhere else it degrades to Georgia — still editorial serif.
 *  Elements also carry class="ms-display" so an [if mso] block can pin Outlook
 *  to Georgia (Word's font resolution on nested-table divs is otherwise flaky). */
const DISPLAY_FONT = "'Playfair Display',Georgia,'Times New Roman',serif"
/** Body face: the recipient's native UI sans, so the prose reads warm and
 *  legible, in deliberate contrast to the serif display accents. */
const BODY_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Localized warm closer ("Warmly," etc.) for the sign-off. */
function closerWord(lang: string): string {
  return lang === "ru" ? "С теплом," : "Warmly,"
}

/** Localized fallback signer when no staff display name is known. */
function teamSigner(lang: string): string {
  return lang === "ru" ? "Команда Morning Star" : "The Morning Star team"
}

/**
 * Inline email-safe styling onto the bare allowed tags, in the public site's
 * voice: serif navy headings, slate body, and — the site's signature move —
 * ITALIC GOLD for emphasis (`<em>`), the same device as "Mending the Broken" in
 * the site's headlines. The greeting (1st <p>) is a serif headline; the opening
 * line (2nd <p>) is a quiet lede.
 */
function styleContentForEmail(html: string): string {
  let para = 0
  const withParas = html.replace(/<p>/gi, () => {
    para++
    if (para === 1) {
      return `<p class="ms-display" style="margin:0 0 18px;font-family:${DISPLAY_FONT};font-size:24px;line-height:1.3;letter-spacing:-0.01em;color:${INK};">`
    }
    if (para === 2) {
      return `<p style="margin:0 0 16px;font-size:17px;line-height:1.62;color:${INK};">`
    }
    return `<p style="margin:0 0 16px;color:${INK_SOFT};">`
  })
  return withParas
    .replace(
      /<h2>/gi,
      `<h2 class="ms-display" style="margin:28px 0 8px;font-family:${DISPLAY_FONT};font-size:22px;font-weight:700;color:${INK};line-height:1.25;letter-spacing:-0.01em;">`,
    )
    .replace(
      /<h3>/gi,
      `<h3 class="ms-display" style="margin:22px 0 6px;font-family:${DISPLAY_FONT};font-size:17px;font-weight:700;color:${INK};line-height:1.35;">`,
    )
    .replace(/<ul>/gi, `<ul style="margin:0 0 16px 22px;padding:0;color:${INK_SOFT};">`)
    .replace(/<ol>/gi, `<ol style="margin:0 0 16px 22px;padding:0;color:${INK_SOFT};">`)
    .replace(/<li>/gi, `<li style="margin:0 0 7px;">`)
    // The site's emphasis device: italic gold.
    .replace(/<em>/gi, `<em style="font-style:italic;color:${GOLD_DARK};">`)
    .replace(/<strong>/gi, `<strong style="font-weight:700;color:${INK};">`)
    .replace(
      /<blockquote>/gi,
      `<blockquote class="ms-display" style="margin:6px 0 18px;padding:2px 0 2px 16px;border-left:2px solid ${GOLD};font-family:${DISPLAY_FONT};font-style:italic;font-size:19px;line-height:1.5;color:${INK};">`,
    )
    .replace(
      /<a /gi,
      `<a style="color:${GOLD_DARK};text-decoration:underline;text-underline-offset:2px;" `,
    )
}

/**
 * The warm human sign-off (plain-text part). The HTML shell styles it; the
 * text/plain version keeps the church name since it has no letterhead.
 */
export function personalSignatureText(senderName: string | null, lang = "en"): string {
  const closer = senderName?.trim() || teamSigner(lang)
  return `${closerWord(lang)}\n${closer}\n${CHURCH_NAME}`
}

/** A full-width thin hairline — the site's section rule. */
function fullRule(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="font-size:0;line-height:0;mso-line-height-rule:exactly;border-top:1px solid ${HAIRLINE};">&#8202;</td></tr></table>`
}

/** Tracked uppercase caps — the site's eyebrow/label device. `pad` offsets the
 *  trailing letter-spacing so left-aligned eyebrows still line up. */
function trackedCaps(text: string, size: number, color: string, spacing = "2.5px"): string {
  return `<span style="font-family:${BODY_FONT};font-size:${size}px;font-weight:600;letter-spacing:${spacing};text-transform:uppercase;color:${color};">${escapeHtml(text)}</span>`
}

/** Sign-off: an italic-gold "Warmly," (the site's emphasis device) over the
 *  sender's name in navy ink. Set off by a short gold rule. Left-aligned, the
 *  way a real letter trails off. */
function signatureHtml(senderName: string | null, lang: string): string {
  const closer = senderName?.trim() || teamSigner(lang)
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;"><tr><td width="40" height="1" style="font-size:0;line-height:0;mso-line-height-rule:exactly;border-top:2px solid ${GOLD};">&#8202;</td></tr></table>
<div style="margin-top:18px;">
<div class="ms-display" style="font-family:${DISPLAY_FONT};font-style:italic;font-size:21px;line-height:1.3;color:${GOLD_DARK};">${closerWord(lang)}</div>
<div style="margin-top:7px;font-family:${BODY_FONT};font-size:15px;font-weight:700;letter-spacing:0.2px;color:${INK};">${escapeHtml(closer)}</div>
</div>`
}

/** The wordmark, matching the site header: "MORNING STAR" in letter-spaced
 *  navy serif caps over tracked muted "CHRISTIAN CHURCH". Live text. */
function headerBlock(): string {
  return `<div class="ms-display" style="font-family:${DISPLAY_FONT};font-size:27px;font-weight:700;letter-spacing:0.08em;line-height:1.1;color:${INK};text-transform:uppercase;">Morning Star</div>
<div style="margin-top:8px;">${trackedCaps("Christian Church", 11, MUTED, "0.2em")}</div>`
}

/** Hidden preheader: controls the inbox preview line so it's the warm opening
 *  sentence, not a scraped fragment. Padded so the client doesn't pull body
 *  text in after it. */
function preheaderBlock(preheader: string): string {
  const text = escapeHtml(preheader.trim()).slice(0, 140)
  const pad = "&#847;&zwnj;&nbsp;".repeat(20)
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG};opacity:0;">${text}${pad}</div>`
}

/**
 * Wrap a sanitized content fragment in the personal stationery shell. The caller
 * MUST pass already-sanitized HTML (the send path sanitizes first). Returns a
 * complete email document — a soft cream card with a gold spine, a Playfair
 * letterhead + greeting, and an italic sign-off — premium but warm, with NO
 * bulk-mail chrome (no masthead-as-banner, no address/unsubscribe footer).
 * Hardened for Outlook (MSO ghost wrapper + PixelsPerInch) and dark mode
 * (light-locked, iOS data-detector recolor disabled).
 */
export function wrapPersonalEmail(args: {
  contentHtml: string
  preheader: string
  senderName: string | null
  lang?: string
}): string {
  const lang = args.lang === "ru" ? "ru" : "en"
  const dateLabel = new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const content = styleContentForEmail(args.contentHtml)
  const signature = signatureHtml(args.senderName, lang)
  const preheader = preheaderBlock(args.preheader)
  const eyebrow = trackedCaps(dateLabel, 11, GOLD, "0.18em")
  // Hosted ghost wordmark, full-bleed behind the header — the faded gold
  // "MORNING STAR" under the crisp navy lockup (the site's warm/cool layering).
  // Honored on Apple Mail/iOS; cleanly stripped to a plain header elsewhere.
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "")
  const headerGhost = base
    ? ` background="${base}/email/masthead-ghost.png" style="background-image:url('${base}/email/masthead-ghost.png');background-repeat:no-repeat;background-position:center 38px;background-size:150% auto;"`
    : ""

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
<!--[if mso]><style>.ms-display{font-family:Georgia,'Times New Roman',serif !important;}</style><![endif]-->
<!--[if !mso]><!-->
<style>@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap');</style>
<!--<![endif]-->
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
<body style="margin:0;padding:0;background-color:${BG};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background-color:${BG};mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;">
<!-- Header: full-bleed faded ghost wordmark behind the crisp navy lockup -->
<tr>
<td align="center"${headerGhost}>
<div style="padding:46px 24px 26px 24px;">
${headerBlock()}
</div>
</td>
</tr>
<!-- Centered content column -->
<tr>
<td align="center" style="padding:0 26px 44px 26px;">
<!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-collapse:collapse;">
<tr><td style="padding-bottom:26px;">${fullRule()}</td></tr>
<!-- The letter: gold dateline eyebrow, serif greeting, body, sign-off -->
<tr><td style="font-family:${BODY_FONT};font-size:16px;line-height:1.66;color:${INK_SOFT};">
<div style="margin-bottom:18px;">${eyebrow}</div>
${content}
${signature}
</td></tr>
<!-- Footer -->
<tr><td style="padding-top:32px;">${fullRule()}</td></tr>
<tr><td align="center" style="padding-top:18px;">
<span style="font-family:${BODY_FONT};font-size:10px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:${FAINT};">Boise ${MIDDOT} Idaho</span>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}
