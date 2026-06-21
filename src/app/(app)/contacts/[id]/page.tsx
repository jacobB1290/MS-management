import type { Metadata } from "next"
import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, MessageSquare, Mail, Pencil, Phone } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { isVoiceConfigured } from "@/server/comms/voice"
import { resolveOptInMode } from "@/server/comms/optInMode"
import { TagList } from "@/components/tag-list"
import { CallButton } from "@/components/call-button"
import { MobileCollapsingHeader } from "@/components/ui/collapsing-header"
import { cn, formatPhone, humanizeSource } from "@/lib/utils"
import { resolveContactBack, withContactFrom } from "@/lib/contact-nav"
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
  // Return-to-origin: the back button and Edit both carry the origin (inbox,
  // a campaign, or the directory) so navigation lands where you came from.
  const { href: backHref, label: backLabel } = resolveContactBack(from, id)
  const editHref = withContactFrom(`/contacts/${id}/edit`, from)

  const supabase = await createSupabaseServerClient()
  const [{ data: contact }, { data: submissions }, { count: messageCount }] =
    await Promise.all([
      supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
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

  // What each submission was about, newest first, de-duplicated. The website
  // attaches a human topic label when a specific CTA (e.g. the cooking ministry)
  // was used; plain "Contact" submissions carry none and are simply omitted.
  const submissionTopics = Array.from(
    new Set(
      (submissions ?? [])
        .map((s) => {
          const p = s.payload
          if (p && typeof p === "object" && !Array.isArray(p)) {
            const label = (p as Record<string, unknown>).topic_label
            if (typeof label === "string") return label.trim()
          }
          return ""
        })
        .filter((label) => label.length > 0),
    ),
  )

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

  // The status flags + the iOS quick-action row, built once and shared by the
  // desktop header band and the mobile collapsing hero. CallButton mounts no
  // Twilio device until it is tapped, so rendering it in both layouts is free.
  const statusMeta =
    contact.is_member ||
    contact.sms_opted_out_at ||
    contact.email_unsubscribed_at ||
    contact.language === "ru" ? (
      <div className="flex flex-wrap items-center justify-center gap-2.5 text-label font-semibold uppercase tracking-[var(--tracking-wide)] leading-none">
        {contact.is_member && <span className="text-gold-dark">Member</span>}
        {contact.sms_opted_out_at && <span className="text-warning">SMS opted-out</span>}
        {contact.email_unsubscribed_at && <span className="text-ink-faint">Email unsubscribed</span>}
        {contact.language === "ru" && <span className="text-gold-dark">Russian</span>}
      </div>
    ) : null

  const renderQuickActions = (includeEdit: boolean) => (
    <div className="flex flex-wrap items-start justify-center gap-4">
      {/* Message → the in-app text thread; greyed when there's no number. */}
      <ActionCircle
        href={`/inbox?c=${contact.id}&ch=sms`}
        label="Message"
        icon={<MessageSquare size={20} />}
        disabled={!contact.phone}
        disabledHint="No phone number on file"
      />
      {voiceConfigured &&
        (contact.phone ? (
          <div className="flex flex-col items-center gap-1.5">
            <CallButton
              contactId={contact.id}
              phone={contact.phone}
              contactName={contact.name}
              voiceConfigured={voiceConfigured}
              variant="icon-soft"
            />
            <span className="text-micro text-ink-muted">Call</span>
          </div>
        ) : (
          <ActionCircle
            label="Call"
            icon={<Phone size={18} />}
            disabled
            disabledHint="No phone number on file"
          />
        ))}
      {/* Email → the in-app email thread; greyed when there's no address. */}
      <ActionCircle
        href={`/inbox?c=${contact.id}&ch=email`}
        label="Email"
        icon={<Mail size={20} />}
        disabled={!contact.email}
        disabledHint="No email on file"
      />
      {includeEdit && (
        <ActionCircle href={editHref} label="Edit" icon={<Pencil size={20} />} />
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* DESKTOP header band — the bespoke iOS contact card. md+ only; on mobile
          the collapsing header inside the scroll region takes over. */}
      <div className="hidden md:block shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-3xl w-full mx-auto">
        <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-x-[var(--space-sm)] [grid-template-areas:'back_title_actions']">
          <div className="flex items-center justify-start [grid-area:back]">
            <Link href={backHref} prefetch aria-label={backLabel} title={backLabel} className="btn-icon-circle">
              <ArrowLeft size={18} />
            </Link>
          </div>
          <h1 className="min-w-0 truncate text-center font-display text-heading text-ink leading-[var(--leading-snug)] tracking-[var(--tracking-tight)] font-semibold [grid-area:title]">
            {displayName}
          </h1>
          <span aria-hidden className="[grid-area:actions]" />
        </div>
        {statusMeta && <div className="mt-1.5">{statusMeta}</div>}
        <div className="mt-5">{renderQuickActions(true)}</div>
      </div>

      {/* The ONE scroll region. On mobile the collapsing header rides at its top:
          the name + status + quick actions live in a hero that scrolls away under
          a frosted bar (a single Edit action stays in the bar); below md the band
          above owns the chrome instead. */}
      <div
        data-scroll-region
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-3xl w-full mx-auto"
      >
        <MobileCollapsingHeader
          title={displayName}
          backHref={backHref}
          backLabel={backLabel}
          actions={
            <Link href={editHref} prefetch aria-label="Edit" title="Edit" className="btn-icon-circle">
              <Pencil size={18} />
            </Link>
          }
          heroExtra={
            <div className="flex flex-col items-center gap-4">
              {statusMeta}
              {renderQuickActions(false)}
            </div>
          }
        />
        <div className="space-y-6">
        {/* Identity as an iOS-style grouped list: small label over value, hairline
            dividers, interactive rows (membership toggle, opt-in, tags) preserved. */}
        <section className="rounded-lg border border-ink-hairline bg-white">
          <dl className="divide-y divide-ink-hairline">
            <InfoRow label="Phone">
              <span className={contact.phone ? "font-mono" : ""}>
                {contact.phone ? formatPhone(contact.phone) : "—"}
              </span>
            </InfoRow>
            <InfoRow label="Email">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-gold hover:underline break-words">
                  {contact.email}
                </a>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Language">{contact.language === "ru" ? "Russian" : "English"}</InfoRow>
            <InfoRow label="Source">{provenance}</InfoRow>

            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <dt className="eyebrow mb-1">Membership</dt>
                <dd className="text-small text-ink-muted">
                  {contact.is_member ? "Marked as a church member" : "Not marked as a member"}
                </dd>
              </div>
              <MemberToggle contactId={contact.id} isMember={contact.is_member} />
            </div>

            <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {/* One word — the longer label wrapped to two lines on mobile
                    and crowded the value text beside the row action. */}
                <dt className="eyebrow mb-1">Marketing</dt>
                <dd className="text-small text-ink-muted">
                  {smsOptedOut
                    ? "Globally opted out of SMS. They must text START first"
                    : marketingOptedIn
                      ? `Opted in${contact.marketing_consent_at ? ` · ${format(new Date(contact.marketing_consent_at), "PP")}` : ""}`
                      : marketingDeclined
                        ? `Declined recurring updates${contact.marketing_opted_out_at ? ` · ${format(new Date(contact.marketing_opted_out_at), "PP")}` : ""}`
                        : "Not opted in to recurring updates (campaigns)"}
                </dd>
                {optInMode && optInMode !== "send" && (
                  <OptInRequest contactId={contact.id} mode={optInMode} requestedAt={contact.marketing_opt_in_requested_at} />
                )}
              </div>
              {optInMode === "send" && (
                <OptInRequest
                  contactId={contact.id}
                  mode={optInMode}
                  requestedAt={contact.marketing_opt_in_requested_at}
                  className="mt-0 shrink-0 whitespace-nowrap"
                />
              )}
            </div>

            <div className="px-4 py-3.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <dt className="eyebrow mb-2">Tags</dt>
                <dd>
                  <TagList tags={contact.tags} aiTags={contact.ai_tags} />
                </dd>
              </div>
              <div className="shrink-0">
                <SuggestTags contactId={contact.id} currentTags={contact.tags ?? []} />
              </div>
            </div>

            {contact.notes && (
              <div className="px-4 py-3.5">
                <dt className="eyebrow mb-1">Notes</dt>
                <dd className="text-body text-ink-muted leading-normal whitespace-pre-wrap">{contact.notes}</dd>
              </div>
            )}
          </dl>
        </section>

        {submissions && submissions.length > 0 && (
          <section className="rounded-lg border border-ink-hairline bg-white p-6">
            <p className="eyebrow mb-1">Consent record</p>
            <p className="text-small text-ink-muted">
              {submissions.length === 1 ? "1 form submission" : `${submissions.length} form submissions`} on
              file as proof of opt-in · {format(new Date(submissions[0].created_at), "PP")}
            </p>
            {submissionTopics.length > 0 && (
              <p className="text-small text-ink-muted mt-1.5">
                Reached out about: {submissionTopics.join(" · ")}
              </p>
            )}
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

// One iOS-style grouped row: small gold label over the value, value in Inter.
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="text-body text-ink break-words">{children}</dd>
    </div>
  )
}

// A circular quick action (iOS contact-card style): tinted gold circle + label.
// Greys out to a non-interactive state when the channel it opens has nothing to
// act on — no phone to text/call, or no email — with a hint on hover.
function ActionCircle({
  href,
  label,
  icon,
  disabled = false,
  disabledHint,
}: {
  href?: string
  label: string
  icon: ReactNode
  disabled?: boolean
  disabledHint?: string
}) {
  const className = "flex flex-col items-center gap-1.5"
  if (disabled || !href) {
    return (
      <div
        className={cn(className, "cursor-not-allowed")}
        aria-disabled="true"
        title={disabledHint ?? `${label} unavailable`}
      >
        <span className="btn-icon-soft is-disabled">{icon}</span>
        <span className="text-micro text-ink-faint">{label}</span>
      </div>
    )
  }
  return (
    <Link href={href} prefetch aria-label={label} className={className}>
      <span className="btn-icon-soft">{icon}</span>
      <span className="text-micro text-ink-muted">{label}</span>
    </Link>
  )
}
