import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { MessageSquare, ArrowLeft, Pencil } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { isVoiceConfigured } from "@/server/comms/voice"
import { resolveOptInMode } from "@/server/comms/optInMode"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CallButton } from "@/components/call-button"
import { formatPhone, humanizeSource } from "@/lib/utils"
import { DeleteContactButton } from "@/components/delete-contact-button"
import { SuggestTags } from "@/components/suggest-tags"
import { OptInRequest } from "@/components/opt-in-request"
import { MemberToggle } from "./member-toggle"

export const metadata: Metadata = { title: "Contact" }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function ContactDetailPage({ params, searchParams }: PageProps) {
  const user = await requireStaff()
  const isAdmin = user.role === "admin"
  const voiceConfigured = isVoiceConfigured()
  const { id } = await params
  const { from } = await searchParams
  const cameFromThread = from === "inbox"
  const backHref = cameFromThread ? `/inbox?c=${id}` : "/contacts"
  const backLabel = cameFromThread ? "Back to conversation" : "All contacts"
  const editHref = cameFromThread ? `/contacts/${id}/edit?from=inbox` : `/contacts/${id}/edit`

  const supabase = await createSupabaseServerClient()
  const [{ data: contact }, { data: messages }, { data: submissions }, { count: messageCount }] =
    await Promise.all([
      supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
      supabase.from("messages").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(20),
      supabase.from("form_submissions").select("*").eq("contact_id", id).order("created_at", { ascending: false }).limit(10),
      supabase.from("messages").select("id", { count: "exact", head: true }).eq("contact_id", id),
    ])

  if (!contact) notFound()

  // Express (marketing) consent is legally distinct from the implied consent
  // that gates 1:1 replies — keep them separate. The opt-in invite only surfaces
  // when the contact is reachable and not already settled either way.
  const marketingOptedIn = Boolean(contact.marketing_consent_at)
  const marketingDeclined = Boolean(contact.marketing_opted_out_at)
  const smsOptedOut = Boolean(contact.sms_opted_out_at)
  const optInMode = await resolveOptInMode(contact)

  const displayName = contact.name ?? formatPhone(contact.phone) ?? contact.email ?? "Unknown"

  // Message-first: lead with the person's own words (their latest inbound),
  // falling back to the most recent message in the thread.
  const lastInbound = messages?.find((m) => m.direction === "in") ?? null
  const latest = messages?.[0] ?? null
  const highlight = lastInbound ?? latest
  const repliedSince = Boolean(lastInbound && latest && latest.id !== lastInbound.id)

  // Provenance collapses to one line: for most contacts the consent date is the
  // same event as creation, so we show source + how they consented + one date.
  const provenanceDate = contact.consent_at ?? contact.created_at
  const provenance =
    [
      humanizeSource(contact.source),
      consentLabel(contact.consent_method),
      provenanceDate ? format(new Date(provenanceDate), "PP") : null,
    ]
      .filter((p): p is string => Boolean(p) && p !== "—")
      .join(" · ") || "—"

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-3xl w-full mx-auto">
        <Link
          href={backHref}
          prefetch
          className="inline-flex items-center gap-1.5 text-small text-ink-muted active:text-ink mb-4 min-h-11"
        >
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        <PageHeader
          eyebrow="Contact"
          title={displayName}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href={`/inbox?c=${contact.id}`}>
                  <MessageSquare size={16} />
                  Open thread
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={editHref}>
                  <Pencil size={14} />
                  Edit
                </Link>
              </Button>
              {voiceConfigured && (
                <CallButton
                  contactId={contact.id}
                  phone={contact.phone}
                  contactName={contact.name}
                  voiceConfigured={voiceConfigured}
                  variant="secondary"
                />
              )}
            </div>
          }
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {contact.is_member && <Badge variant="gold">Member</Badge>}
          {contact.sms_opted_out_at && <Badge variant="warning">SMS opted-out</Badge>}
          {contact.email_unsubscribed_at && <Badge variant="muted">Email unsubscribed</Badge>}
          {contact.language === "ru" && <Badge variant="gold">Russian</Badge>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full mx-auto space-y-6">
        {/* Message-first: the human's own words lead the record, not metadata. */}
        {highlight && (
          <section className="rounded-lg border border-ink-hairline bg-white p-6">
            <p className="eyebrow mb-2">{lastInbound ? "What they said" : "Latest message"}</p>
            <p className="text-lead text-ink leading-prose whitespace-pre-wrap">
              {highlight.body ?? "(media)"}
            </p>
            <p className="text-micro text-ink-muted mt-2" data-dynamic>
              {repliedSince ? "Replied · " : ""}
              {format(new Date(highlight.created_at), "MMM d, p")}
            </p>
          </section>
        )}

        <section className="rounded-lg border border-ink-hairline bg-white p-6">
          <p className="eyebrow">Identity</p>
          <dl className="mt-4 space-y-3">
            <Row label="Name" value={contact.name ?? "—"} />
            <Row label="Phone" value={contact.phone ? formatPhone(contact.phone) : "—"} mono={Boolean(contact.phone)} />
            <Row label="Email" value={contact.email ?? "—"} />
            <Row label="Language" value={contact.language === "ru" ? "Russian" : "English"} />
            <Row label="Source" value={provenance} />
          </dl>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-hairline pt-4">
            <div className="min-w-0">
              <p className="eyebrow">Membership</p>
              <p className="text-small text-ink-muted mt-0.5">
                {contact.is_member ? "Marked as a church member" : "Not marked as a member"}
              </p>
            </div>
            <MemberToggle contactId={contact.id} isMember={contact.is_member} />
          </div>

          <div className="mt-4 border-t border-ink-hairline pt-4">
            <p className="eyebrow">Marketing messages</p>
            <p className="text-small text-ink-muted mt-0.5">
              {smsOptedOut
                ? "Globally opted out of SMS. They must text START first"
                : marketingOptedIn
                  ? `Opted in${contact.marketing_consent_at ? ` · ${format(new Date(contact.marketing_consent_at), "PP")}` : ""}`
                  : marketingDeclined
                    ? `Declined recurring updates${contact.marketing_opted_out_at ? ` · ${format(new Date(contact.marketing_opted_out_at), "PP")}` : ""}`
                    : "Not opted in to recurring updates (campaigns)"}
            </p>
            {optInMode && (
              <OptInRequest contactId={contact.id} mode={optInMode} requestedAt={contact.marketing_opt_in_requested_at} />
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-ink-hairline">
            <p className="eyebrow mb-2">Tags</p>
            {contact.tags && contact.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t) => (
                  <Badge key={t} variant="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-small text-ink-muted italic">No tags yet</p>
            )}
            <SuggestTags contactId={contact.id} currentTags={contact.tags ?? []} />
          </div>

          {contact.notes && (
            <div className="mt-6 pt-4 border-t border-ink-hairline">
              <p className="eyebrow mb-2">Notes</p>
              <p className="text-body text-ink-muted leading-normal whitespace-pre-wrap">{contact.notes}</p>
            </div>
          )}
        </section>

        {submissions && submissions.length > 0 && (
          <section className="rounded-lg border border-ink-hairline bg-white p-6">
            <p className="eyebrow mb-1">Consent record</p>
            <p className="text-small text-ink-muted">
              {submissions.length === 1 ? "1 form submission" : `${submissions.length} form submissions`} on
              file as proof of opt-in · {format(new Date(submissions[0].created_at), "PP")}
            </p>
          </section>
        )}

        {isAdmin && (
          <section className="rounded-lg border border-danger/30 bg-white p-6">
            <p className="eyebrow text-danger mb-1">Danger zone</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-small text-ink-muted max-w-prose">
                Permanently delete this contact and their entire message thread. This can’t be undone.
              </p>
              <DeleteContactButton
                contactId={contact.id}
                contactName={displayName === "Unknown" ? "this contact" : displayName}
                messageCount={messageCount ?? undefined}
                redirectTo="/contacts"
              />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// Friendly consent-method label for the provenance line. Form/CSV methods are
// omitted (the source already names that channel, and the form proof has its own
// line); verbal/written are surfaced as the only signal of how consent was taken.
function consentLabel(method: string | null): string | null {
  if (!method) return null
  if (method.startsWith("public_form") || method.startsWith("csv_import")) return null
  const map: Record<string, string> = { verbal: "verbal consent", written: "written consent" }
  return map[method] ?? method.replace(/_/g, " ")
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className={`col-span-2 text-body text-ink break-words ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}
