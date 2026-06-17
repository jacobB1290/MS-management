import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { BASE_TAG_VOCAB } from "@/server/ai/prompts"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { withContactFrom } from "@/lib/contact-nav"
import { ContactForm } from "../../new/contact-form"

export const metadata: Metadata = { title: "Edit contact" }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function EditContactPage({ params, searchParams }: PageProps) {
  await requireStaff()
  const { id } = await params
  const { from } = await searchParams
  // Back to the contact detail, carrying the origin through so the full chain
  // (origin → detail → edit → back → detail → back → origin) returns correctly.
  const backHref = withContactFrom(`/contacts/${id}`, from)
  const supabase = await createSupabaseServerClient()
  const [{ data: contact }, tagOccurrences] = await Promise.all([
    supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
    getContactTagOccurrences(),
  ])
  if (!contact) notFound()
  const tagSuggestions = Array.from(new Set([...BASE_TAG_VOCAB, ...tagOccurrences]))
    .filter(Boolean)
    .sort()

  return (
    <DetailScaffold
      title="Edit contact"
      backHref={backHref}
      backLabel="Back to contact"
      info="Update what we know. Consent method and source are preserved from the original record."
    >
      <div className="mx-auto w-full max-w-2xl pt-6">
        <div className="rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
          <ContactForm contactId={id} initialValues={contact} tagSuggestions={tagSuggestions} returnFrom={from} />
        </div>
      </div>
    </DetailScaffold>
  )
}
