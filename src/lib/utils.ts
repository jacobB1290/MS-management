import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge about our custom font-size tokens. Without this it
// treats `text-small`, `text-heading`, etc. as members of the same group as
// `text-white` / `text-ink` (the text-color group) and drops the color when
// both appear on one element — e.g. the gold Avatar (`bg-gold text-white
// text-small`) lost its white text.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "hero",
            "title",
            "heading",
            "lead",
            "body",
            "compact",
            "small",
            "label",
            "micro",
            "eyebrow",
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ""
  // Cheap US-friendly display: +15551234567 -> (555) 123-4567
  // Anything non-US falls back to the raw E.164.
  if (e164.startsWith("+1") && e164.length === 12) {
    const a = e164.slice(2, 5)
    const b = e164.slice(5, 8)
    const c = e164.slice(8, 12)
    return `(${a}) ${b}-${c}`
  }
  return e164
}

export function initials(name: string | null | undefined): string {
  if (!name) return "·"
  const trimmed = name.trim()
  // If the "name" is a phone number, show the last 2 digits instead of "+1".
  if (/^[+\d]/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "")
    if (digits.length >= 2) return digits.slice(-2)
    return "·"
  }
  const parts = trimmed.split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·"
}
