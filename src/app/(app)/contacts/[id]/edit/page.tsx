import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { ContactForm } from "../../new/contact-form"

export const metadata: Metadata = { title: "Edit contact" }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditContactPage({ params }: PageProps) {
  await requireStaff()
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!contact) notFound()

  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-2xl">
      <Link
        href={`/contacts/${id}`}
        className="inline-flex items-center gap-1.5 text-small text-ink-muted hover:text-ink mb-4"
      >
        <ArrowLeft size={14} /> Back to contact
      </Link>

      <PageHeader eyebrow="Directory" title="Edit contact" />
      <p className="mt-2 text-ink-muted text-body leading-normal">
        Update what we know. Consent and source are preserved from the
        original record.
      </p>

      <div className="mt-8 rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
        <ContactForm contactId={id} initialValues={contact} />
      </div>
    </div>
  )
}
