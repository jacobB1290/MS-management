import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { BASE_TAG_VOCAB } from "@/server/ai/prompts"
import { PageHeader } from "@/components/ui/page-header"
import { ContactForm } from "./contact-form"

export const metadata: Metadata = { title: "New contact" }

export default async function NewContactPage() {
  await requireStaff()
  const supabase = await createSupabaseServerClient()
  const { data: tagRows } = await supabase.from("contacts").select("tags").limit(1000)
  const tagSuggestions = Array.from(
    new Set([...BASE_TAG_VOCAB, ...(tagRows ?? []).flatMap((r) => (r.tags ?? []) as string[])]),
  )
    .filter(Boolean)
    .sort()
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-4 bg-bg max-w-2xl w-full">
        <PageHeader
          eyebrow="Directory"
          title="New contact"
          info="Add someone manually. For everyone arriving from the public website form, the form receiver creates them automatically with the form as the proof of opt-in."
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 pb-6 md:pb-8 max-w-2xl w-full">
        <div className="rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
          <ContactForm tagSuggestions={tagSuggestions} />
        </div>
      </div>
    </div>
  )
}
