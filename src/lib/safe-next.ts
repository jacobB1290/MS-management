/**
 * Sanitize a post-auth `next` redirect target. Only internal, path-relative
 * destinations are allowed — this blocks open-redirect / phishing via a
 * crafted `?next=https://evil.com` (or protocol-relative `//evil.com`).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/inbox"): string {
  if (!next) return fallback
  if (!next.startsWith("/")) return fallback // reject absolute URLs (https://…, mailto:, etc.)
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback // reject protocol-relative
  return next
}
