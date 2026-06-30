/**
 * Contact notes are a running memory of durable facts, stored as ONE fact per
 * line (newline-separated) in the single `contacts.notes` text column. The
 * bullet glyph is purely presentational — keeping storage as plain lines means
 * the AI merge (`mergeNotes`), the 2000-char cap, and older paragraph-style
 * notes all stay simple, and the UI is free to render each line as a bullet.
 *
 * These pure helpers are the single source of truth for splitting the field
 * into bullets and joining bullets back into the stored string. They are
 * dependency-free and import-safe in client components (no server-only).
 */

// Leading list markers a person (or an older imported note) might have typed
// at the start of a line. Stripped on parse so the UI never renders a double
// bullet, and on join so the stored value stays clean plain text.
const LEADING_MARKER = /^\s*(?:[-*•·–—]|\d+[.)])\s+/

/** Split the stored notes string into individual bullet facts (trimmed, no
 *  empties, leading markers stripped). A legacy single-paragraph note simply
 *  comes back as one bullet. */
export function splitNoteLines(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_MARKER, "").trim())
    .filter((line) => line.length > 0)
}

/** Join bullet facts back into the stored string: one fact per line, trimmed,
 *  empties dropped, any stray leading marker removed. Inverse of
 *  splitNoteLines. */
export function joinNoteLines(lines: string[]): string {
  return lines
    .map((line) => line.replace(/[\r\n]+/g, " ").replace(LEADING_MARKER, "").trim())
    .filter((line) => line.length > 0)
    .join("\n")
}
