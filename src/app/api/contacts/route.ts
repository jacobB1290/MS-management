import { NextResponse, type NextRequest } from "next/server"
import { contactCreateSchema } from "@/server/validation/schemas"
import { requireStaff } from "@/server/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"

/** Create a contact. */
export async function POST(request: NextRequest) {
  const user = await requireStaff()
  const parsed = contactCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 })
  }
  const data = parsed.data

  const admin = createSupabaseAdminClient()
  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      name: data.name ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      source: data.source ?? "manual",
      tags: data.tags ?? [],
      language: data.language ?? "en",
      consent_method: data.consent_method,
      consent_at: data.consent_at ?? new Date().toISOString(),
      notes: data.notes ?? null,
    })
    .select("id")
    .single()

  if (error || !created) {
    if (error?.message.includes("duplicate")) {
      // find-or-create: hand back the existing contact (by normalized phone)
      // so the caller can open/continue the thread instead of dead-ending.
      if (data.find_or_create && data.phone) {
        const { data: existing } = await admin
          .from("contacts")
          .select("id")
          .eq("phone", data.phone)
          .maybeSingle()
        if (existing) {
          return NextResponse.json({ ok: true, id: existing.id, existing: true })
        }
      }
      return NextResponse.json({ error: "duplicate_phone" }, { status: 409 })
    }
    return NextResponse.json({ error: error?.message ?? "insert_failed" }, { status: 500 })
  }

  await logAudit({
    action: "contact.create",
    actorUserId: user.id,
    targetTable: "contacts",
    targetId: created.id,
    diff: data as never,
  })

  return NextResponse.json({ ok: true, id: created.id }, { status: 201 })
}
