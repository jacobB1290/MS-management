import type { Tables } from "@/lib/database.types"

type Message = Tables<"messages">

/** One email thread: a run of emails that share a subject (a reply chain). */
export interface EmailThread {
  /** Stable grouping key (normalized subject, else the Gmail thread id, else the
   *  message id for a lone subjectless email). */
  key: string
  /** Display subject — the base subject with any `Re:`/`Fwd:` prefixes stripped. */
  subject: string
  /** Messages oldest-first. */
  messages: Message[]
  /** ISO timestamp of the most recent message in the thread. */
  lastAt: string
  count: number
}

// Collapses one or more leading "Re:" / "Fwd:" / "Fw:" prefixes (any spacing/case).
const REPLY_PREFIX = /^(?:\s*(?:re|fwd|fw)\s*:\s*)+/i

/** The base subject a thread is keyed on: prefixes stripped, whitespace
 *  collapsed. "Re: Visiting" and "visiting " both reduce to "Visiting". */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "").replace(REPLY_PREFIX, "").replace(/\s+/g, " ").trim()
}

/** "Re: <base>" for replying into a thread; "" when there's no base subject to
 *  reply to, so the composer falls back to a blank (new) subject. */
export function replySubjectFor(subject: string): string {
  const base = normalizeSubject(subject)
  return base ? `Re: ${base}` : ""
}

function gmailThreadKey(m: Message): string | null {
  const meta = m.email_meta as { gmail_thread_id?: string | null } | null
  return meta?.gmail_thread_id ? `gmail:${meta.gmail_thread_id}` : null
}

/** Group email messages into subject-threads. Grouping is by normalized subject
 *  (case-insensitive) so a reply chain collapses regardless of how it was sent —
 *  Gmail-mirrored or CRM-composed — falling back to the Gmail thread id, then the
 *  message id, for subjectless mail. Threads are ordered by last activity
 *  (most-recently-active LAST) so the live thread sits nearest the composer in
 *  the bottom-anchored scroller; messages within a thread are chronological. */
export function groupEmailThreads(messages: Message[]): EmailThread[] {
  const groups = new Map<string, Message[]>()
  const display = new Map<string, string>()

  for (const m of messages) {
    const base = normalizeSubject(m.subject)
    const key = base.toLowerCase() || gmailThreadKey(m) || `msg:${m.id}`
    const arr = groups.get(key)
    if (arr) arr.push(m)
    else groups.set(key, [m])
    // Keep a human display subject for the key; the first non-empty one wins and
    // is good enough (a thread's subject is stable in practice).
    if (base && !display.has(key)) display.set(key, base)
  }

  const threads: EmailThread[] = []
  for (const [key, msgs] of groups) {
    msgs.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
    threads.push({
      key,
      subject: display.get(key) ?? "No subject",
      messages: msgs,
      lastAt: msgs[msgs.length - 1].created_at,
      count: msgs.length,
    })
  }
  threads.sort((a, b) => +new Date(a.lastAt) - +new Date(b.lastAt))
  return threads
}

/** The thread the composer should target by default: the most-recently-active
 *  one (so a reply continues the latest conversation), or null when there are no
 *  email threads yet (compose a fresh one). */
export function latestThreadKey(threads: EmailThread[]): string | null {
  return threads.length ? threads[threads.length - 1].key : null
}
