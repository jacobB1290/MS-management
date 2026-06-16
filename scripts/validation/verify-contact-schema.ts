/**
 * Guards a data-loss bug: marking a contact as a member (or any partial PATCH
 * that omits phone/email) used to WIPE phone + email. The cause was
 * optionalPhoneField / optionalEmailField transforming an OMITTED field into
 * `null`, which the update route then wrote. They must instead leave an omitted
 * field `undefined` (no opinion — the route skips it) and only turn an explicit
 * empty/null into `null` (the deliberate "clear it" path).
 *
 * Run: npx tsx scripts/validation/verify-contact-schema.ts  (or `npm run verify:schema`)
 *
 * Relative import (no `@/` alias) so it runs under plain tsx; schemas.ts only
 * pulls in zod + libphonenumber, so this is pure + fast.
 */
import { contactUpdateSchema } from "../../src/server/validation/schemas"

let failed = 0
function check(name: string, ok: boolean) {
  if (ok) {
    console.log("ok:", name)
  } else {
    failed++
    console.error("FAIL:", name)
  }
}

// A member toggle sends only { is_member } — phone/email must be left untouched
// (undefined), NOT cleared to null.
const memberOnly = contactUpdateSchema.parse({ is_member: true })
check("member toggle leaves phone undefined", memberOnly.phone === undefined)
check("member toggle leaves email undefined", memberOnly.email === undefined)
check("member toggle keeps is_member", memberOnly.is_member === true)

// A tags-only update likewise must not touch phone/email.
const tagsOnly = contactUpdateSchema.parse({ tags: ["visitor"] })
check("tags-only leaves phone undefined", tagsOnly.phone === undefined)
check("tags-only leaves email undefined", tagsOnly.email === undefined)

// The deliberate "clear it" path still works: explicit null / empty -> null.
// (These cases short-circuit before phone parsing, so no libphonenumber here —
// keeping the guard pure zod so it runs under plain tsx.)
const cleared = contactUpdateSchema.parse({ phone: null, email: "" })
check("explicit null phone clears to null", cleared.phone === null)
check("explicit empty email clears to null", cleared.email === null)

if (failed > 0) {
  console.error(`\n${failed} contact-schema check(s) failed.`)
  process.exit(1)
}
console.log("\nAll contact-schema checks passed.")
