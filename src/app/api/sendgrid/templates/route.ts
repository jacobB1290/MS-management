import { NextResponse, type NextRequest } from "next/server"
import { requireStaff } from "@/server/auth"

/**
 * SendGrid Dynamic Templates, for the campaign composer's template picker.
 *   GET  — list dynamic templates so the operator can pick one (auto-fills
 *          the template ID + subject instead of pasting a d-xxx string).
 *   POST — create a new blank dynamic template and return its id, so the UI
 *          can fill the field and open the SendGrid builder to design it.
 *
 * Staff-gated. Degrades to `configured: false` when SENDGRID_API_KEY is unset
 * so the UI can prompt to connect SendGrid rather than erroring.
 */
const SENDGRID = "https://api.sendgrid.com/v3"

type SendgridVersion = { active?: number; subject?: string }
type SendgridTemplate = {
  id: string
  name: string
  updated_at?: string
  versions?: SendgridVersion[]
}

export async function GET() {
  await requireStaff()
  const key = process.env.SENDGRID_API_KEY
  if (!key) return NextResponse.json({ configured: false, templates: [] })

  try {
    const res = await fetch(`${SENDGRID}/templates?generations=dynamic&page_size=200`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200)
      return NextResponse.json(
        { configured: true, error: `SendGrid ${res.status}`, detail, templates: [] },
        { status: 502 },
      )
    }
    const json = (await res.json()) as { result?: SendgridTemplate[] }
    const templates = (json.result ?? []).map((t) => {
      const active = t.versions?.find((v) => v.active === 1) ?? t.versions?.[0]
      return {
        id: t.id,
        name: t.name,
        updatedAt: t.updated_at ?? null,
        subject: active?.subject ?? null,
      }
    })
    return NextResponse.json({ configured: true, templates })
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : "fetch_failed", templates: [] },
      { status: 502 },
    )
  }
}

export async function POST(request: NextRequest) {
  await requireStaff()
  const key = process.env.SENDGRID_API_KEY
  if (!key) return NextResponse.json({ error: "not_configured" }, { status: 503 })

  const body = (await request.json().catch(() => null)) as { name?: string } | null
  const name = (body?.name?.trim() || "Untitled template").slice(0, 100)

  try {
    const res = await fetch(`${SENDGRID}/templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, generation: "dynamic" }),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200)
      return NextResponse.json({ error: `SendGrid ${res.status}`, detail }, { status: 502 })
    }
    const json = (await res.json()) as { id?: string; name?: string }
    if (!json.id) return NextResponse.json({ error: "no_id" }, { status: 502 })
    return NextResponse.json({ ok: true, id: json.id, name: json.name ?? name })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create_failed" },
      { status: 502 },
    )
  }
}
