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
const GOLD = "#9d7853"
const GOLD_DARK = "#6e5239"
const GOLD_DEEP = "#4d3826"
const GOLD_LIGHT = "#c9a86f"
const INK = "#1f1a14"
const INK_SOFT = "#3a342b"
const FAINT = "#8a8174"
const PAGE_BG = "#f1e9da" // warm cream page behind the card
const CARD_BG = "#fbf7f1"
const HAIRLINE = "#e7ddca"

const GOLD_FRAME = "#dac7a4" // delicate gold for the inset stationery frame + rules
// The morning-star motif. Used ONCE, as the letterhead crown — a rare mark reads
// bespoke; a repeated glyph reads like filler. U+2726 followed by U+FE0E (the
// text variation selector) so emoji-capable clients render the monochrome gold
// glyph instead of substituting a multicolor emoji.
const STAR = "&#10022;&#65038;"
// Symbol-first stack so the star resolves to a real text glyph, never an emoji
// font and never tofu.
const STAR_FONT = "'Apple Symbols','Segoe UI Symbol','Noto Sans Symbols2',Georgia,serif"

const CHURCH_NAME = "Morning Star Christian Church"
const CHURCH_LOCALE = "Boise, Idaho"

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
 * Inline email-safe styling onto the bare allowed tags. The sanitizer strips
 * every attribute (except href on <a>), so each opening tag is bare and a
 * targeted replace is safe — consistent rhythm and on-brand gold links even in
 * clients (Gmail) that ignore <style> blocks. The FIRST paragraph (the AI/staff
 * greeting, e.g. "Hi Jacob,") is set in the display serif as an editorial lead.
 */
function styleContentForEmail(html: string): string {
  let firstPara = true
  const withParas = html.replace(/<p>/gi, () => {
    if (firstPara) {
      firstPara = false
      return `<p class="ms-display" style="margin:0 0 18px;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.45;color:${INK};">`
    }
    return `<p style="margin:0 0 16px;color:${INK_SOFT};">`
  })
  return withParas
    .replace(
      /<h2>/gi,
      `<h2 class="ms-display" style="margin:26px 0 8px;font-family:${DISPLAY_FONT};font-size:21px;font-weight:600;color:${INK};line-height:1.3;">`,
    )
    .replace(
      /<h3>/gi,
      `<h3 class="ms-display" style="margin:22px 0 6px;font-family:${DISPLAY_FONT};font-size:17px;font-weight:600;color:${INK};line-height:1.4;">`,
    )
    .replace(/<ul>/gi, `<ul style="margin:0 0 16px 22px;padding:0;color:${INK_SOFT};">`)
    .replace(/<ol>/gi, `<ol style="margin:0 0 16px 22px;padding:0;color:${INK_SOFT};">`)
    .replace(/<li>/gi, `<li style="margin:0 0 7px;">`)
    .replace(
      /<blockquote>/gi,
      `<blockquote class="ms-display" style="margin:4px 0 18px;padding:2px 0 2px 18px;border-left:3px solid ${GOLD};font-family:${DISPLAY_FONT};font-style:italic;font-size:18px;line-height:1.5;color:${GOLD_DARK};">`,
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

/** A short, left-anchored gold rule — the divider used to set off the sign-off,
 *  built as a bordered cell so Outlook renders the hairline reliably. */
function shortRule(width = 44, color = GOLD_FRAME, align: "left" | "center" = "left"): string {
  // Only center emits an `align` attr; `align="left"` would make the table FLOAT
  // and the next line (e.g. "Warmly,") would wrap up beside the rule. A bare
  // block table left-aligns without floating.
  const alignAttr = align === "center" ? ` align="center"` : ""
  return `<table role="presentation"${alignAttr} cellpadding="0" cellspacing="0" border="0"><tr><td width="${width}" height="1" style="font-size:0;line-height:0;mso-line-height-rule:exactly;border-top:1px solid ${color};">&#8202;</td></tr></table>`
}

/** Sign-off as a handwritten close: a left rule, an italic serif "Warmly," then
 *  the sender's name — left-aligned, the way a real letter trails off. Personal
 *  (a person, not an org); the church identity lives in the letterhead. */
function signatureHtml(senderName: string | null, lang: string): string {
  const closer = senderName?.trim() || teamSigner(lang)
  return `<div style="margin-top:30px;">${shortRule(44, GOLD)}</div>
<div style="margin-top:18px;">
<div class="ms-display" style="font-family:${DISPLAY_FONT};font-style:italic;font-size:20px;line-height:1.3;color:${GOLD_DARK};">${closerWord(lang)}</div>
<div style="margin-top:7px;font-family:${BODY_FONT};font-size:15px;font-weight:600;letter-spacing:0.2px;color:${INK};">${escapeHtml(closer)}</div>
</div>`
}

/** The letterhead: the morning-star crown, a designed wordmark lockup
 *  ("Morning Star" in display serif over tracked small-caps "CHRISTIAN CHURCH"),
 *  a centered hairline, and a dated dateline — bespoke stationery written today,
 *  not a logo banner. */
function letterheadHtml(dateLabel: string): string {
  return `<tr>
<td align="center" style="padding:38px 40px 0 40px;">
<div style="font-family:${STAR_FONT};font-size:17px;line-height:1;color:${GOLD};margin-bottom:16px;">${STAR}</div>
<div class="ms-display" style="font-family:${DISPLAY_FONT};font-size:31px;font-weight:700;letter-spacing:0;line-height:1.05;color:${GOLD};white-space:nowrap;">Morning Star</div>
<div style="margin-top:7px;font-family:${BODY_FONT};font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:${GOLD_DARK};">Christian Church</div>
<div style="margin-top:18px;">${shortRule(46, GOLD_FRAME, "center")}</div>
<div style="margin-top:14px;font-family:${BODY_FONT};font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${FAINT};">${escapeHtml(dateLabel)}</div>
</td>
</tr>`
}

/** Hidden preheader: controls the inbox preview line so it's the warm opening
 *  sentence, not a scraped fragment. Padded so the client doesn't pull body
 *  text in after it. */
function preheaderBlock(preheader: string): string {
  const text = escapeHtml(preheader.trim()).slice(0, 140)
  const pad = "&#847;&zwnj;&nbsp;".repeat(20)
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CARD_BG};opacity:0;">${text}${pad}</div>`
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
  const letterhead = letterheadHtml(dateLabel)

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
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG};mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;">
<tr>
<td align="center" style="padding:40px 18px;">
<!--[if mso]><table role="presentation" align="center" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="max-width:560px;width:100%;background-color:${CARD_BG};border:1px solid ${HAIRLINE};border-radius:16px;box-shadow:0 16px 40px rgba(77,56,38,0.14);overflow:hidden;border-collapse:collapse;">
<tr>
<td style="height:3px;line-height:3px;font-size:0;background-color:${GOLD};background:linear-gradient(90deg,${GOLD_DEEP} 0%,${GOLD_LIGHT} 30%,${GOLD} 52%,${GOLD_LIGHT} 72%,${GOLD_DEEP} 100%);">&#8203;</td>
</tr>
<tr>
<td bgcolor="${CARD_BG}" style="padding:13px;background-color:${CARD_BG};mso-padding-alt:13px 13px 13px 13px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${GOLD_FRAME};border-radius:8px;border-collapse:separate;">
${letterhead}
<tr>
<td bgcolor="${CARD_BG}" style="padding:14px 38px 36px 38px;background-color:${CARD_BG};font-family:${BODY_FONT};font-size:16px;line-height:1.65;color:${INK_SOFT};">
${content}
${signature}
</td>
</tr>
</table>
</td>
</tr>
</table>
<div style="font-family:${BODY_FONT};font-size:11px;letter-spacing:0.4px;color:${FAINT};text-align:center;padding:20px 0 0 0;">${CHURCH_LOCALE}</div>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}
