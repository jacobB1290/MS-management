import "server-only"

/**
 * Strip quoted history from an inbound email reply so the inbox bubble shows
 * only what the person actually wrote this time — the email equivalent of how
 * an SMS reply carries no thread. Conservative on purpose: it cuts at the first
 * recognized quote separator and keeps everything above it. If nothing matches,
 * the whole body is returned untouched (better to show too much than to clip a
 * real message).
 */
const SEPARATOR_PATTERNS: RegExp[] = [
  // "On Tue, May 28, 2026 at 9:14 AM Jane Doe <jane@x.com> wrote:" (Gmail/Apple)
  /^On .+ wrote:$/,
  /^On .+ wrote:\s*$/,
  // Outlook / Exchange original-message dividers
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{5,}$/,
  // Outlook header block start
  /^From:\s.+/i,
  // Generic "wrote:" trailing a citation that spilled onto its own line
  /^.*\b\d{1,2}:\d{2}\s?(AM|PM)\b.*wrote:$/i,
]

export function stripQuotedReply(text: string | null | undefined): string {
  if (!text) return ""
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const kept: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // A run of quoted lines ('>' prefix) marks the start of the citation.
    if (trimmed.startsWith(">")) break
    if (SEPARATOR_PATTERNS.some((re) => re.test(trimmed))) break
    kept.push(line)
  }

  // Drop trailing blank lines left behind once the quote is removed.
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Pull useful header values out of SendGrid Inbound Parse's raw `headers`
 * string (one `Key: value` per line, continuation lines indented). We only need
 * a few: Message-ID for idempotency, plus In-Reply-To / References for record.
 */
export function parseEmailHeaders(raw: string | null | undefined): {
  messageId: string | null
  inReplyTo: string | null
  references: string | null
} {
  const get = (name: string): string | null => {
    if (!raw) return null
    const re = new RegExp(`^${name}:\\s*(.+)$`, "im")
    const m = raw.match(re)
    return m ? m[1].trim() : null
  }
  return {
    messageId: get("Message-ID") ?? get("Message-Id"),
    inReplyTo: get("In-Reply-To"),
    references: get("References"),
  }
}
