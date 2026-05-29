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
const INK = "#1f1a14"
const INK_SOFT = "#3a342b"
const FAINT = "#8a8174"
const CARD_BG = "#fbf7f1" // single warm-white ground; no card, type sits flat on it

const GOLD_FRAME = "#dac7a4" // delicate gold for the rule dividers
// Typographic ornament: a gold middot used as a fleuron in the masthead flourish
// and the rule dividers. Rendered in a serif so it's a clean centered dot, never
// an emoji or tofu — ornament built from type, not an illustration.
const MIDDOT = "&middot;"
const ORNAMENT_FONT = "Georgia,'Times New Roman',serif"

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
 * Inline email-safe styling onto the bare allowed tags. The sanitizer strips
 * every attribute (except href on <a>), so each opening tag is bare and a
 * targeted replace is safe — consistent rhythm and on-brand gold links even in
 * clients (Gmail) that ignore <style> blocks. The FIRST paragraph (the AI/staff
 * greeting, e.g. "Hi Jacob,") is set in the display serif as an editorial lead.
 */
function styleContentForEmail(html: string): string {
  // The first paragraph becomes an editorial display-serif lead ONLY when it
  // reads like a short greeting ("Hi Jacob,"). A plain typed email is often one
  // long paragraph with no greeting; setting that whole block in the display
  // face looks wrong, so it stays in the readable body face.
  const firstInner = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  const firstText = firstInner.replace(/<[^>]+>/g, "").trim()
  const leadFirst = firstText.length > 0 && firstText.length <= 50 && /[,:]$/.test(firstText)

  let isFirst = true
  const withParas = html.replace(/<p>/gi, () => {
    const lead = isFirst && leadFirst
    isFirst = false
    return lead
      ? `<p class="ms-display" style="margin:0 0 18px;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.45;color:${INK};">`
      : `<p style="margin:0 0 16px;color:${INK_SOFT};">`
  })
  const styled = withParas
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
  return styled
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

/** A centered hairline-rule divider with a single gold middot at its heart —
 *  the typographic counterpart to a ruled fleuron. */
function ruledDivider(rule = 46): string {
  const ruleCell = `<td valign="middle" width="${rule}" style="font-size:0;line-height:0;"><div style="height:1px;background-color:${GOLD_FRAME};font-size:0;line-height:0;">&nbsp;</div></td>`
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>${ruleCell}<td valign="middle" style="padding:0 13px;font-family:${ORNAMENT_FONT};font-size:15px;line-height:1;color:${GOLD};">${MIDDOT}</td>${ruleCell}</tr></table>`
}

/** A short tracked-caps band (eyebrow / dateline / footer locale) — type set as
 *  ornament. */
function trackedCaps(text: string, size: number, color: string): string {
  return `<div style="font-family:${BODY_FONT};font-size:${size}px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:${color};padding-left:2.5px;">${escapeHtml(text)}</div>`
}

/** The crisp wordmark — LIVE TEXT (renders everywhere, inverts cleanly in dark
 *  mode, no broken-image state, no image-ratio spam signal). The faded ghost
 *  behind it is a full-bleed CSS background applied to the masthead row in
 *  `wrapPersonalEmail`, so it reaches the page edges. */
function mastheadHtml(): string {
  return `<div class="ms-display" style="font-family:${DISPLAY_FONT};font-size:40px;font-weight:700;line-height:1.12;color:${GOLD_DEEP};white-space:nowrap;">Morning Star</div>`
}

/** The letterhead's centered contents: the live wordmark, tracked small-caps
 *  "CHRISTIAN CHURCH", a ruled-middot divider, and a tracked dateline. Sits in a
 *  full-width row so the ghost behind it can bleed to the page edges. */
function letterheadInner(dateLabel: string): string {
  return `${mastheadHtml()}
<div style="margin-top:6px;">${trackedCaps("Christian Church", 11, GOLD_DARK)}</div>
<div style="margin-top:20px;">${ruledDivider(46)}</div>
<div style="margin-top:15px;">${trackedCaps(dateLabel, 10, FAINT)}</div>`
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
  const letterhead = letterheadInner(dateLabel)
  // Full-bleed ghost: applied to the masthead ROW (full email width) so the
  // faded oversized word reaches the page edges, cropped there. Honored by Apple
  // Mail/iOS; stripped (cleanly) by Gmail/Outlook.
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "")
  const ghostBg = base
    ? ` background="${base}/email/masthead-ghost.png" style="background-image:url('${base}/email/masthead-ghost.png');background-repeat:no-repeat;background-position:center top;background-size:150% auto;padding:46px 0 4px 0;"`
    : ` style="padding:46px 0 4px 0;"`

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
<body style="margin:0;padding:0;background-color:${CARD_BG};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="background-color:${CARD_BG};mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;">
<tr>
<td align="center"${ghostBg}>
${letterhead}
</td>
</tr>
<tr>
<td align="center" style="padding:8px 22px 44px 22px;">
<!--[if mso]><table role="presentation" align="center" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;">
<tr>
<td style="padding:0 8px 0 8px;font-family:${BODY_FONT};font-size:16px;line-height:1.65;color:${INK_SOFT};">
${content}
${signature}
</td>
</tr>
</table>
<div style="font-family:${BODY_FONT};font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:${FAINT};text-align:center;padding:28px 0 0 0;">Boise ${MIDDOT} Idaho</div>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`
}
