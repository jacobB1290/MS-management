import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { InquiryForm } from "./inquiry-form"

export const metadata: Metadata = { title: "New inquiry" }

export default async function NewInquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string }>
}) {
  await requireStaff()
  const { contact: contactId } = await searchParams

  let linkedContact: { id: string; name: string | null; phone: string | null } | null = null
  if (contactId) {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
      .from("contacts")
      .select("id, name, phone")
      .eq("id", contactId)
      .maybeSingle()
    linkedContact = data ?? null
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-6 md:pt-8 pb-4 bg-bg max-w-2xl w-full">
        <Link
          href="/inquiries"
          prefetch
          className="inline-flex items-center gap-1.5 text-small text-ink-muted active:text-ink mb-4 min-h-11"
        >
          <ArrowLeft size={14} /> All inquiries
        </Link>
        <PageHeader eyebrow="Front desk" title="New inquiry" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-2xl w-full">
        <InquiryForm linkedContact={linkedContact} />
      </div>
    </div>
  )
}
