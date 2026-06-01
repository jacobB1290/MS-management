import "server-only"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { logAudit } from "@/server/audit"
import type { Tables, TablesUpdate } from "@/lib/database.types"
import type { EventForGcal } from "@/server/google/eventMapping"
import {
  createCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
} from "@/server/google/calendar"
import { uploadDriveImage, deleteDriveFile } from "@/server/google/drive"

/**
 * Event orchestration: the CRM `events` table is the editing surface; Google
 * Calendar is the public backend ms.church reads. This module is the only place
 * that bridges the two — it pushes CRM edits to the calendar, copies the flyer
 * to Drive so the site can show it, and reconciles events authored directly in
 * Calendar back into the table (the "full two-way edit" model).
 *
 * Everything degrades cleanly when Google isn't configured: writes return a
 * mock id and the row still flips to published, so the flow is fully exercisable
 * (and harness-testable) before OAuth is wired up.
 */

type EventRow = Tables<"events">

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export type EventCreateInput = {
  title: string
  description?: string | null
  starts_at: string
  ends_at?: string | null
  all_day?: boolean
  location?: string | null
  cta_text?: string | null
  cta_url?: string | null
  image_storage_path?: string | null
  image_public_url?: string | null
}

export type EventUpdateInput = Partial<EventCreateInput>

function rowToGcal(row: EventRow): EventForGcal {
  return {
    title: row.title,
    description: row.description,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    all_day: row.all_day,
    location: row.location,
    cta_text: row.cta_text,
    cta_url: row.cta_url,
    image_drive_file_id: row.image_drive_file_id,
  }
}

/** Pull image bytes from a public URL (the CRM's Supabase copy) for Drive upload. */
async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return null
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()
    if (!mimeType.startsWith("image/")) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
    return { bytes, mimeType }
  } catch {
    return null
  }
}

/**
 * Make sure a row's flyer has a Drive copy (the attachment the public site
 * reads). Uploads the CRM's stored image to Drive when one is pending, and
 * persists the resulting file id. Returns the (possibly updated) row.
 */
async function ensureDriveImage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: EventRow,
): Promise<{ ok: true; row: EventRow } | { ok: false; error: string }> {
  // Already has a Drive copy, or nothing to upload.
  if (row.image_drive_file_id || !row.image_public_url) return { ok: true, row }

  const img = await fetchImageBytes(row.image_public_url)
  if (!img) return { ok: false, error: "image_fetch_failed" }

  const ext = img.mimeType.split("/")[1] || "jpg"
  const uploaded = await uploadDriveImage({
    bytes: img.bytes,
    mimeType: img.mimeType,
    name: `${row.title.slice(0, 60) || "event"}-${row.id}.${ext}`,
  })
  if (!uploaded.ok) return { ok: false, error: uploaded.error }

  const { data, error } = await admin
    .from("events")
    .update({ image_drive_file_id: uploaded.fileId })
    .eq("id", row.id)
    .select("*")
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "image_persist_failed" }
  return { ok: true, row: data }
}

export type EventWriteResult =
  | { ok: true; id: string; mock?: boolean }
  | { ok: false; error: string }

/** Create a CRM-only draft. No Google write until publish. */
export async function createEvent(
  input: EventCreateInput,
  userId: string,
): Promise<EventWriteResult> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from("events")
    .insert({
      title: input.title,
      description: input.description ?? null,
      starts_at: input.starts_at,
      ends_at: input.ends_at ?? null,
      all_day: input.all_day ?? false,
      location: input.location ?? null,
      cta_text: input.cta_text ?? null,
      cta_url: input.cta_url ?? null,
      image_storage_path: input.image_storage_path ?? null,
      image_public_url: input.image_public_url ?? null,
      status: "draft",
      source: "crm",
      created_by: userId,
    })
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" }

  await logAudit({
    action: "event.create",
    actorUserId: userId,
    targetTable: "events",
    targetId: data.id,
    diff: { title: input.title, starts_at: input.starts_at },
  })
  return { ok: true, id: data.id }
}

/**
 * Apply an edit. If the event is already published, the change is pushed to the
 * calendar immediately (re-uploading the flyer to Drive first when it changed),
 * so editing a live event updates ms.church right away.
 */
export async function updateEvent(
  id: string,
  input: EventUpdateInput,
  userId: string,
): Promise<EventWriteResult> {
  const admin = createSupabaseAdminClient()
  const { data: existing, error: loadErr } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (loadErr || !existing) return { ok: false, error: "not_found" }

  const patch: TablesUpdate<"events"> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description ?? null
  if (input.starts_at !== undefined) patch.starts_at = input.starts_at
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at ?? null
  if (input.all_day !== undefined) patch.all_day = input.all_day
  if (input.location !== undefined) patch.location = input.location ?? null
  if (input.cta_text !== undefined) patch.cta_text = input.cta_text ?? null
  if (input.cta_url !== undefined) patch.cta_url = input.cta_url ?? null
  // A new uploaded flyer clears the Drive copy so it re-uploads on the push.
  if (input.image_storage_path !== undefined || input.image_public_url !== undefined) {
    patch.image_storage_path = input.image_storage_path ?? null
    patch.image_public_url = input.image_public_url ?? null
    patch.image_drive_file_id = null
  }

  const { data: updated, error: updErr } = await admin
    .from("events")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single()
  if (updErr || !updated) return { ok: false, error: updErr?.message ?? "update_failed" }

  let mock = false
  if (updated.status === "published" && updated.gcal_event_id) {
    const withImage = await ensureDriveImage(admin, updated)
    if (!withImage.ok) return { ok: false, error: withImage.error }
    const pushed = await updateCalendarEvent(updated.gcal_event_id, rowToGcal(withImage.row))
    if (!pushed.ok) return { ok: false, error: pushed.error }
    mock = pushed.mock
    await admin.from("events").update({ synced_at: new Date().toISOString() }).eq("id", id)
  }

  await logAudit({
    action: "event.update",
    actorUserId: userId,
    targetTable: "events",
    targetId: id,
    diff: { fields: Object.keys(patch) },
  })
  return { ok: true, id, mock }
}

/**
 * Publish a draft (or re-publish a cancelled event): upload the flyer to Drive,
 * create or update the calendar event, and flip the row to published.
 */
export async function publishEvent(id: string, userId: string): Promise<EventWriteResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }

  const withImage = await ensureDriveImage(admin, row)
  if (!withImage.ok) return { ok: false, error: withImage.error }

  const written = row.gcal_event_id
    ? await updateCalendarEvent(row.gcal_event_id, rowToGcal(withImage.row))
    : await createCalendarEvent(rowToGcal(withImage.row))
  if (!written.ok) return { ok: false, error: written.error }

  const { error: flipErr } = await admin
    .from("events")
    .update({
      status: "published",
      gcal_event_id: written.gcalEventId,
      synced_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (flipErr) return { ok: false, error: flipErr.message }

  await logAudit({
    action: "event.publish",
    actorUserId: userId,
    targetTable: "events",
    targetId: id,
    diff: { gcal_event_id: written.gcalEventId, mock: written.mock },
  })
  return { ok: true, id, mock: written.mock }
}

/** Take an event off the public site by cancelling it on the calendar. */
export async function cancelEvent(id: string, userId: string): Promise<EventWriteResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }

  if (row.gcal_event_id) {
    const cancelled = await cancelCalendarEvent(row.gcal_event_id)
    if (!cancelled.ok) return { ok: false, error: cancelled.error ?? "cancel_failed" }
  }
  await admin.from("events").update({ status: "cancelled" }).eq("id", id)

  await logAudit({
    action: "event.cancel",
    actorUserId: userId,
    targetTable: "events",
    targetId: id,
  })
  return { ok: true, id }
}

/** Permanently delete an event (admin): remove from calendar + Drive + table. */
export async function deleteEvent(id: string, userId: string): Promise<EventWriteResult> {
  const admin = createSupabaseAdminClient()
  const { data: row, error } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !row) return { ok: false, error: "not_found" }

  if (row.gcal_event_id) {
    const del = await deleteCalendarEvent(row.gcal_event_id)
    if (!del.ok) return { ok: false, error: del.error ?? "delete_failed" }
  }
  // Best-effort: only delete Drive files the CRM created (it has a local copy).
  if (row.image_drive_file_id && row.image_storage_path) {
    await deleteDriveFile(row.image_drive_file_id).catch(() => {})
  }
  const { error: delErr } = await admin.from("events").delete().eq("id", id)
  if (delErr) return { ok: false, error: delErr.message }

  await logAudit({
    action: "event.delete",
    actorUserId: userId,
    targetTable: "events",
    targetId: id,
    diff: { title: row.title, gcal_event_id: row.gcal_event_id },
  })
  return { ok: true, id }
}

export type SyncResult =
  | { ok: true; imported: number; updated: number; cancelled: number; mock: boolean }
  | { ok: false; error: string }

/**
 * Reconcile the calendar into the table: import events authored directly in
 * Google Calendar, refresh published rows from the calendar, and mark rows
 * whose calendar event has disappeared as cancelled. CRM-only drafts (no
 * gcal_event_id) are never touched.
 */
export async function syncEventsFromCalendar(userId: string): Promise<SyncResult> {
  const admin = createSupabaseAdminClient()
  const listed = await listCalendarEvents()
  if (!listed.ok) return { ok: false, error: listed.error }

  const { data: rows } = await admin
    .from("events")
    .select("id, gcal_event_id, status, image_storage_path")
  const byGcalId = new Map<string, { id: string; status: string; image_storage_path: string | null }>()
  for (const r of rows ?? []) {
    if (r.gcal_event_id) {
      byGcalId.set(r.gcal_event_id, {
        id: r.id,
        status: r.status,
        image_storage_path: r.image_storage_path,
      })
    }
  }

  let imported = 0
  let updated = 0
  const seen = new Set<string>()

  for (const ev of listed.events) {
    seen.add(ev.gcal_event_id)
    const existing = byGcalId.get(ev.gcal_event_id)
    if (!existing) {
      await admin.from("events").insert({
        gcal_event_id: ev.gcal_event_id,
        title: ev.title,
        description: ev.description,
        starts_at: ev.starts_at,
        ends_at: ev.ends_at,
        all_day: ev.all_day,
        location: ev.location,
        cta_text: ev.cta_text,
        cta_url: ev.cta_url,
        image_drive_file_id: ev.image_drive_file_id,
        image_public_url: ev.image_public_url,
        status: ev.status,
        source: "gcal",
        synced_at: new Date().toISOString(),
      })
      imported += 1
    } else {
      // Refresh mirrored fields. Keep the CRM's own flyer URL when it has a
      // local copy (its Supabase URL is nicer for preview than the lh3 one).
      await admin
        .from("events")
        .update({
          title: ev.title,
          description: ev.description,
          starts_at: ev.starts_at,
          ends_at: ev.ends_at,
          all_day: ev.all_day,
          location: ev.location,
          cta_text: ev.cta_text,
          cta_url: ev.cta_url,
          image_drive_file_id: ev.image_drive_file_id,
          ...(existing.image_storage_path ? {} : { image_public_url: ev.image_public_url }),
          status: ev.status,
          synced_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
      updated += 1
    }
  }

  // Published rows whose calendar event vanished → reflect as cancelled.
  let cancelled = 0
  for (const [gcalId, info] of byGcalId) {
    if (!seen.has(gcalId) && info.status === "published") {
      await admin.from("events").update({ status: "cancelled" }).eq("id", info.id)
      cancelled += 1
    }
  }

  await logAudit({
    action: "event.sync",
    actorUserId: userId,
    targetTable: "events",
    targetId: null,
    diff: { imported, updated, cancelled, mock: listed.mock },
  })
  return { ok: true, imported, updated, cancelled, mock: listed.mock }
}
