import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·"
}
