import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { BASE_TAG_VOCAB } from "@/server/ai/prompts"
import { getContactTagOccurrences } from "@/server/contacts/tags"
import { DetailScaffold } from "@/components/ui/detail-scaffold"
import { ContactForm } from "./contact-form"

export const metadata: Metadata = { title: "New contact" }

export default async function NewContactPage() {
  await requireStaff()
  const tagSuggestions = Array.from(
    new Set([...BASE_TAG_VOCAB, ...(await getContactTagOccurrences())]),
  )
    .filter(Boolean)
    .sort()
  return (
    <DetailScaffold
      title="New contact"
      backHref="/contacts"
      backLabel="All contacts"
      info="Add someone manually. For everyone arriving from the public website form, the form receiver creates them automatically with the form as the proof of opt-in."
    >
      <div className="mx-auto w-full max-w-2xl pt-6">
        <div className="rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
          <ContactForm tagSuggestions={tagSuggestions} />
        </div>
      </div>
    </DetailScaffold>
  )
}
