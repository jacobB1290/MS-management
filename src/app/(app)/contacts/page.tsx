import Link from "next/link"
import { Plus } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PageMasthead } from "@/components/ui/page-masthead"
import { PAGE_GUTTER } from "@/components/ui/page-scaffold"
import { ContactsSearch } from "./contacts-search"
import { ContactsIndex } from "./contacts-index"
import { cn, formatPhone } from "@/lib/utils"
import type { Tables } from "@/lib/database.types"

export const metadata = { title: "Contacts" }

type Row = Pick<Tables<"contacts">, "id" | "name" | "phone" | "email" | "sms_opted_out_at">

interface ContactsPageProps {
  searchParams: Promise<{ q?: string; tag?: string }>
}

// What the row shows + how it sorts/groups: the name, falling back to a
// formatted phone, then email.
function displayName(c: Row): string {
  const n = c.name?.trim()
  if (n) return n
  const p = formatPhone(c.phone)
  if (p) return p
  return c.email ?? "Unknown"
}

// iOS buckets anything not starting with a letter under "#".
function sectionKey(c: Row): string {
  const n = c.name?.trim()
  const first = n?.[0]
  return first && /[a-z]/i.test(first) ? first.toUpperCase() : "#"
}

const byName = (a: Row, b: Row) =>
  displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" })

const KEY_ORDER = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"]

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const { q, tag } = await searchParams
  await requireStaff()
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from("contacts")
    .select("id, name, phone, email, sms_opted_out_at")
    .limit(1000)

  if (q && q.trim()) {
    const like = `%${q.trim()}%`
    query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
  }
  if (tag && tag.trim()) {
    query = query.overlaps("tags", [tag.trim()])
  }

  const [{ data: contacts }, allTags] = await Promise.all([
    query,
    getContactTagOccurrences(),
  ])

  const rows = contacts ?? []
  const filtered = Boolean(q?.trim() || tag?.trim())

  // Opted-out (STOP) contacts live in their own section at the bottom, out of
  // the A–Z directory — they can't be messaged until they text START back.
  const stopped = rows.filter((c) => c.sms_opted_out_at).sort(byName)
  const active = rows.filter((c) => !c.sms_opted_out_at)

  const groups = new Map<string, Row[]>()
  for (const c of active) {
    const k = sectionKey(c)
    const arr = groups.get(k)
    if (arr) arr.push(c)
    else groups.set(k, [c])
  }
  for (const arr of groups.values()) arr.sort(byName)
  const sectionKeys = KEY_ORDER.filter((k) => groups.has(k))

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn("shrink-0 pt-4 md:pt-5 bg-bg", PAGE_GUTTER)}>
        {/* md+ masthead carries the page identity (below md the mobile topbar
            already says "Contacts"), matching Events and Campaigns. */}
        <PageMasthead
          title="Contacts"
          description="Everyone the church talks to, in one directory."
          toolbar={
            <ContactsSearch initialQuery={q ?? ""} initialTag={tag ?? ""} tags={allTags} />
          }
          actions={
            <Link href="/contacts/new" aria-label="New contact" className="btn-icon-action">
              <Plus size={20} strokeWidth={2.5} />
            </Link>
          }
        />
      </div>

      <div className="relative flex-1 min-h-0">
        <div data-scroll-region className="h-full overflow-y-auto overscroll-contain pb-8">
          {rows.length === 0 ? (
            <div className={cn("py-10", PAGE_GUTTER)}>
              <EmptyState
                title={filtered ? "No matches" : "No contacts yet"}
                body={
                  filtered
                    ? "Try a different search or clear the filter."
                    : "Add contacts manually, or wire up the public website form to create them automatically."
                }
                action={
                  !filtered && (
                    <Button asChild>
                      <Link href="/contacts/new">Add the first contact</Link>
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <>
              {sectionKeys.map((key) => (
                <section key={key} aria-label={key}>
                  <SectionHeader id={`csec-${key}`}>{key}</SectionHeader>
                  {groups.get(key)!.map((c) => (
                    <ContactRow key={c.id} contact={c} />
                  ))}
                </section>
              ))}

              {stopped.length > 0 && (
                <section aria-label="Opted out">
                  <SectionHeader>{`Opted out · ${stopped.length}`}</SectionHeader>
                  {stopped.map((c) => (
                    <ContactRow key={c.id} contact={c} stopped />
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        {/* The A–Z scrubber only makes sense on the full directory. */}
        {!filtered && sectionKeys.length > 0 && <ContactsIndex present={sectionKeys} />}
      </div>
    </div>
  )
}

function SectionHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className={cn(
        "sticky top-0 z-[5] scroll-mt-0 bg-bg/90 py-1 text-label font-semibold uppercase tracking-[var(--tracking-wide)] text-ink-faint backdrop-blur supports-[backdrop-filter]:bg-bg/75",
        PAGE_GUTTER,
      )}
    >
      {children}
    </div>
  )
}

// iOS-style row: round avatar, name, hairline divider inset to start after the
// avatar (so the dividers line up under the text, not the whole row). On md+
// the row earns its width: phone and (at xl) email ride along right-aligned in
// muted ink, so the desktop directory reads as a directory instead of a
// stretched phone list. Each is skipped when it would just repeat the name.
function ContactRow({ contact, stopped = false }: { contact: Row; stopped?: boolean }) {
  const shown = displayName(contact)
  const phoneLabel = formatPhone(contact.phone)
  return (
    <Link
      href={`/contacts/${contact.id}`}
      prefetch
      className={cn("flex items-center gap-3 hover:bg-white/60 active:bg-white/60 transition-colors", PAGE_GUTTER)}
    >
      <Avatar name={contact.name ?? contact.phone} size="md" />
      <div className="flex min-w-0 flex-1 items-center gap-3 border-b border-ink-hairline py-3">
        <span className={stopped ? "truncate text-ink-muted" : "truncate font-medium text-ink"}>
          {shown}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 md:gap-6">
          {/* Fixed-width slots (rendered even when empty) so phone and email
              line up as quiet columns down the whole directory instead of
              ragged per-row positions. */}
          <span className="hidden md:block w-36 text-right text-small tabular-nums text-ink-muted">
            {phoneLabel && phoneLabel !== shown ? phoneLabel : null}
          </span>
          <span className="hidden xl:block w-64 truncate text-small text-ink-faint">
            {contact.email && contact.email !== shown ? contact.email : null}
          </span>
          {stopped && (
            <span className="text-micro font-semibold uppercase tracking-wide text-warning">
              Stopped
            </span>
          )}
        </span>
      </div>
    </Link>
  )
}
