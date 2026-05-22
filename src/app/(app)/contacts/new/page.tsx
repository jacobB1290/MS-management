import type { Metadata } from "next"
import { requireStaff } from "@/server/auth"
import { PageHeader } from "@/components/ui/page-header"
import { ContactForm } from "./contact-form"

export const metadata: Metadata = { title: "New contact" }

export default async function NewContactPage() {
  await requireStaff()
  return (
    <div className="px-4 md:px-8 py-6 md:py-8 max-w-2xl">
      <PageHeader
        eyebrow="Directory"
        title="New contact"
      />
      <p className="mt-2 text-ink-muted text-body leading-normal">
        Add someone manually. For everyone arriving from the public website form,
        the form receiver creates them automatically with the form as the proof
        of opt-in.
      </p>

      <div className="mt-8 rounded-lg border border-ink-hairline bg-white p-6 md:p-8">
        <ContactForm />
      </div>
    </div>
  )
}
