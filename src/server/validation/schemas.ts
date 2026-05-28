import { z } from "zod"
import { toE164 } from "./phone"

/** A phone field that accepts any input and stores the E.164 form. */
export const phoneField = z
  .string()
  .trim()
  .min(1)
  .transform((v, ctx) => {
    const e164 = toE164(v)
    if (!e164) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid phone number.",
      })
      return z.NEVER
    }
    return e164
  })

export const optionalPhoneField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null
    const e164 = toE164(v)
    if (!e164) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid phone number.",
      })
      return z.NEVER
    }
    return e164
  })

export const emailField = z
  .string()
  .trim()
  .email()
  .transform((v) => v.toLowerCase())

export const optionalEmailField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine(
    (v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Enter a valid email.",
  )

export const contactCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional().nullable(),
    phone: optionalPhoneField,
    email: optionalEmailField,
    source: z.string().trim().max(60).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(50).optional().default([]),
    language: z.enum(["en", "ru"]).optional().default("en"),
    consent_method: z.string().trim().max(60),
    consent_at: z.string().datetime().optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    // When true, a phone collision returns the existing contact instead of a
    // 409 — lets the inbox "new message" flow find-or-create in one call.
    find_or_create: z.boolean().optional(),
  })
  .refine((d) => d.phone || d.email, {
    message: "Provide at least a phone or an email.",
    path: ["phone"],
  })

export const contactUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional().nullable(),
  phone: optionalPhoneField,
  email: optionalEmailField,
  tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  language: z.enum(["en", "ru"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_member: z.boolean().optional(),
})

export const sendSmsSchema = z
  .object({
    contact_id: z.string().uuid(),
    body: z.string().trim().max(1600).optional().default(""), // 10 SMS segments
    media_url: z.string().url().optional().nullable(),
  })
  .refine((d) => d.body.length > 0 || Boolean(d.media_url), {
    message: "Add a message or an attachment.",
    path: ["body"],
  })

/** One uploaded email attachment, threaded from the upload route → send. */
export const emailAttachmentSchema = z.object({
  path: z.string().trim().min(1).max(120),
  filename: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative(),
})

export const sendEmailSchema = z.object({
  contact_id: z.string().uuid(),
  subject: z.string().trim().min(1, "Add a subject.").max(200),
  body: z.string().trim().min(1, "Write a message.").max(20000),
  // Optional beautified HTML content fragment (no <html>/<body>). When present,
  // the send path sanitizes it, wraps it in the branded template, and sends a
  // multipart text+html email; otherwise plain text only.
  html: z.string().max(60000).optional().nullable(),
  attachments: z.array(emailAttachmentSchema).max(10).optional().default([]),
})

export const voiceTokenSchema = z.object({
  contact_id: z.string().uuid(),
})

export const campaignCreateSchema = z
  .discriminatedUnion("channel", [
    z.object({
      channel: z.literal("sms"),
      name: z.string().trim().min(1).max(120),
      body: z.string().trim().max(1600).optional().default(""),
      media_url: z.string().url().optional().nullable(),
      audience_filter: z.record(z.string(), z.unknown()).optional().default({}),
      scheduled_at: z.string().datetime().optional().nullable(),
    }),
    z.object({
      channel: z.literal("email"),
      name: z.string().trim().min(1).max(120),
      sendgrid_template_id: z.string().trim().min(1).max(60),
      email_subject: z.string().trim().min(1).max(200),
      audience_filter: z.record(z.string(), z.unknown()).optional().default({}),
      scheduled_at: z.string().datetime().optional().nullable(),
    }),
  ])
  .superRefine((data, ctx) => {
    if (data.channel === "sms" && data.body.length === 0 && !data.media_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add a message or an attachment.",
        path: ["body"],
      })
    }
  })

export const aiSuggestTagsSchema = z.object({
  contact_id: z.string().uuid(),
})

export const aiDraftReplySchema = z.object({
  contact_id: z.string().uuid(),
  draft: z.string().max(1600).optional().default(""),
})

export const aiDraftEmailSchema = z.object({
  contact_id: z.string().uuid(),
  draft: z.string().max(20000).optional().default(""),
})

export const publicFormSubmissionSchema = z.object({
  form_id: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120).optional().nullable(),
  phone: optionalPhoneField,
  email: optionalEmailField,
  consent_method: z.string().trim().min(1).max(60),
  // Secondary, explicit opt-in to recurring/marketing messages. Distinct from
  // the baseline consent_method (which only covers the reply to this very
  // submission). A checked box on the form sets marketing_consent_at.
  marketing_opt_in: z.boolean().optional().default(false),
  // The free-text the person typed ("your question, prayer request, or
  // message"). When present it seeds the contact's inbox thread as the first
  // inbound message, so the submission shows up as a conversation staff can
  // reply to. 1600 chars = 10 SMS segments, matching the send-side cap.
  message: z.string().trim().min(1).max(1600).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
})

// Inbox segment + per-conversation status. The category vocabulary and which
// status values are valid per category live in @/lib/inbox-segments; this
// schema only enforces shape (the route validates status against the category).
export const inboxSegmentSchema = z
  .object({
    category: z.enum(["general", "prayer", "question", "outreach"]).optional(),
    status: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((v) => v.category !== undefined || v.status !== undefined, {
    message: "Provide a category and/or status to update.",
  })
