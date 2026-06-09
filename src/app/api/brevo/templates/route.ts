import { NextResponse } from "next/server"
import { requireStaff } from "@/server/auth"
import { brevoConfigured, listTemplates } from "@/server/comms/brevo"

/**
 * Brevo templates for the campaign composer's picker. Designs are authored in
 * Brevo's template editor; the CRM lists them so the operator picks one (which
 * fills the numeric template id + subject). Degrades to `configured: false` when
 * BREVO_API_KEY is unset, so the UI prompts to connect Brevo rather than error.
 */
export async function GET() {
  await requireStaff()
  if (!brevoConfigured()) return NextResponse.json({ configured: false, templates: [] })

  const res = await listTemplates()
  if (!res.ok) {
    return NextResponse.json(
      { configured: true, error: `Brevo ${res.status}`, detail: res.error, templates: [] },
      { status: 502 },
    )
  }
  const templates = (res.data.templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    subject: t.subject ?? null,
    updatedAt: t.modifiedAt ?? null,
    isActive: t.isActive ?? true,
  }))
  return NextResponse.json({ configured: true, templates })
}
