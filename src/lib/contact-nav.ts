/**
 * Where a contact detail / edit page returns to, from the `?from=` origin it was
 * opened with. ONE source of truth so the back links across the contact pages
 * (detail, edit, and the form's post-save redirect) can't drift. Supported:
 *   - "inbox"           → the conversation the contact was opened from
 *   - "campaign:<id>"   → the campaign whose recipient list it was opened from
 *   - anything else/none → the contacts directory (the default)
 *
 * Pure + dependency-free so both server pages and the client form can use it.
 */
export function resolveContactBack(
  from: string | undefined,
  contactId: string,
): { href: string; label: string } {
  if (from === "inbox") return { href: `/inbox?c=${contactId}`, label: "Back to conversation" }
  if (from?.startsWith("campaign:")) {
    const campaignId = from.slice("campaign:".length)
    if (campaignId) return { href: `/campaigns/${campaignId}`, label: "Back to campaign" }
  }
  return { href: "/contacts", label: "All contacts" }
}

/**
 * Append the `from` origin to a contact-scoped href so the back chain survives a
 * hop — e.g. detail → edit → back → detail → back → origin all return correctly.
 */
export function withContactFrom(href: string, from: string | undefined): string {
  if (!from) return href
  const sep = href.includes("?") ? "&" : "?"
  return `${href}${sep}from=${encodeURIComponent(from)}`
}
