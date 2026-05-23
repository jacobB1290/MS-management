import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { MessageSquare, ArrowLeft, Pencil } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatPhone, humanizeSource } from "@/lib/utils"

export const metadata: Metadata = { title: "Contact" }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function ContactDetailPage({ params, searchParams }: PageProps) {
  await requireStaff()
  const { id } = await params
  const { from } = await searchParams
  const cameFromThread = from === "inbox"
  const backHref = cameFromThread ? `/inbox?c=${id}` : "/contacts"
  const backLabel = cameFromThread ? "Back to conversation" : "All contacts"
  const editHref = cameFromThread ? `/contacts/${id}/edit?from=inbox` : `/contacts/${id}/edit`

  const supabase = await createSupabaseServerClient()
  const [{ data: contact }, { data: messages }, { data: submissions }] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabase.from("messages").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("form_submissions").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(10),
  ])

  if (!contact) notFound()

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-4xl w-full">
        <Link
          href={backHref}
          prefetch
          className="inline-flex items-center gap-1.5 text-small text-ink-muted active:text-ink mb-4 min-h-11"
        >
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        <PageHeader
          eyebrow="Contact"
          title={contact.name ?? formatPhone(contact.phone) ?? contact.email ?? "Unknown"}
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="secondary">
                <Link href={editHref}>
                  <Pencil size={14} />
                  Edit
                </Link>
              </Button>
              <Button asChild>
                <Link href={`/inbox?c=${contact.id}`}>
                  <MessageSquare size={16} />
                  Open thread
                </Link>
              </Button>
            </div>
          }
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {contact.sms_opted_out_at && <Badge variant="warning">SMS opted-out</Badge>}
          {contact.email_unsubscribed_at && <Badge variant="muted">Email unsubscribed</Badge>}
          {contact.language === "ru" && <Badge variant="gold">Russian</Badge>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-4xl w-full">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="md:col-span-2 rounded-lg border border-ink-hairline bg-white p-6">
          <p className="eyebrow">Identity</p>
          <dl className="mt-4 space-y-3">
            <Row label="Name" value={contact.name ?? "—"} />
            <Row label="Phone" value={contact.phone ? formatPhone(contact.phone) : "—"} mono={Boolean(contact.phone)} />
            <Row label="Email" value={contact.email ?? "—"} />
            <Row label="Language" value={contact.language === "ru" ? "Russian" : "English"} />
            <Row label="Source" value={humanizeSource(contact.source)} />
            <Row
              label="Consent"
              value={
                contact.consent_method
                  ? `${contact.consent_method}${contact.consent_at ? ` · ${format(new Date(contact.consent_at), "PP")}` : ""}`
                  : "—"
              }
            />
            <Row
              label="Created"
              value={format(new Date(contact.created_at), "PP")}
            />
          </dl>

          {contact.notes && (
            <div className="mt-6 pt-4 border-t border-ink-hairline">
              <p className="eyebrow mb-2">Notes</p>
              <p className="text-body text-ink-muted leading-normal whitespace-pre-wrap">
                {contact.notes}
              </p>
            </div>
          )}

          {contact.tags && contact.tags.length > 0 && (
            <div className="mt-6 pt-4 border-t border-ink-hairline">
              <p className="eyebrow mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t) => (
                  <Badge key={t} variant="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-ink-hairline bg-white p-6">
            <p className="eyebrow mb-3">Recent messages</p>
            {!messages || messages.length === 0 ? (
              <p className="text-ink-faint text-small">No messages yet.</p>
            ) : (
              <ol className="space-y-3">
                {messages.slice(0, 5).map((m) => (
                  <li key={m.id} className="text-small">
                    <p className="text-ink-muted line-clamp-2">{m.body ?? "(media)"}</p>
                    <p className="text-micro text-ink-faint mt-0.5" data-dynamic>
                      {m.direction === "out" ? "→" : "←"}{" "}
                      {format(new Date(m.created_at), "MMM d, p")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {submissions && submissions.length > 0 && (
            <section className="rounded-lg border border-ink-hairline bg-white p-6">
              <p className="eyebrow mb-3">Form submissions</p>
              <ol className="space-y-2">
                {submissions.map((s) => (
                  <li key={s.id} className="text-small">
                    <p className="text-ink-muted">
                      <span className="font-mono">{s.form_id ?? "form"}</span>
                    </p>
                    <p className="text-micro text-ink-faint" data-dynamic>
                      {format(new Date(s.created_at), "MMM d, p")}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="text-label text-ink-faint">{label}</dt>
      <dd className={`col-span-2 text-body text-ink break-words ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  )
}
