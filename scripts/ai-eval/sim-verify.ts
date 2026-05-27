/**
 * Drift guard — keeps the simulation in sync with the live CRM.
 *
 * Run in CI / a pre-commit hook (`npm run sim:verify`). It does NOT call any
 * model; it re-derives everything deterministically from the committed engine
 * outputs using the CURRENT production guards and checks nothing has drifted:
 *
 *   1. Re-grade: applying today's guards (floors from src/server/ai/prompts.ts,
 *      lifecycle from src/lib/inbox-segments.ts) to the recorded model outputs
 *      must reproduce the committed sim-result.json. If a CRM guard changes,
 *      this fails — telling you to re-run `npm run sim:build` (or `npm run sim`).
 *   2. Re-generate: the committed src/server/demo/fixtures.ts must byte-match a
 *      fresh generation from sim-result.json (catches hand-edits / generator
 *      drift).
 *   3. Corpus sanity: ids unique, expectations reference real categories,
 *      lifecycle statuses, and seed tags; the seed vocab carries no sensitive
 *      tag.
 *
 * Exits non-zero on any failure.
 */
import { readFileSync } from "fs"
import { assemble } from "./sim-assemble"
import { generate } from "./sim-gen-fixtures"
import { outreachSim, SEED_VOCAB } from "./outreach-sim"
import { SENSITIVE_TAG, TRIAGE_CONFIDENCE_FLOOR, OPTOUT_CONFIDENCE_FLOOR } from "../../src/server/ai/prompts"
import { INBOX_CATEGORIES, CATEGORY_STATUS, isInboxCategory, type InboxCategory } from "../../src/lib/inbox-segments"

const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const fails: string[] = []
const ok = (cond: boolean, label: string, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail && !cond ? ` — ${detail}` : ""}`)
  if (!cond) fails.push(`${label}${detail ? `: ${detail}` : ""}`)
}

console.log(`Guards in use (from the CRM): triage floor ${TRIAGE_CONFIDENCE_FLOOR}, opt-out floor ${OPTOUT_CONFIDENCE_FLOOR}\n`)

// 1. Re-grade reproduces the committed result.
console.log("1. Result matches current guards")
const fresh = assemble()
const committedResult = readText("sim-result.json").trim()
const freshResult = JSON.stringify(fresh.finals, null, 2)
ok(freshResult === committedResult, "sim-result.json up to date", "guards changed — run `npm run sim:build`")
console.log(`     (grade: ${fresh.passed}/${fresh.total} checks vs human expectations)`)

// 2. Re-generate byte-matches the committed demo fixtures.
console.log("\n2. Demo fixtures match the result")
const committedFixtures = readText("../../src/server/demo/fixtures.ts")
ok(generate() === committedFixtures, "src/server/demo/fixtures.ts up to date", "drifted — run `npm run sim:build`")

// 3. Corpus sanity.
console.log("\n3. Corpus integrity")
const ids = outreachSim.map((c) => c.id)
ok(ids.length === new Set(ids).size, "conversation ids unique")
const lifecycle = (cat: InboxCategory) => CATEGORY_STATUS[cat].map((s) => s.value)
let badCat = "", badStatus = "", badTag = ""
for (const c of outreachSim) {
  const e = c.expect
  if (e.category && !isInboxCategory(e.category)) badCat += ` ${c.id}:${e.category}`
  if (e.category && e.status != null && !lifecycle(e.category).includes(e.status)) badStatus += ` ${c.id}:${e.status}`
  for (const t of e.mustTagAny ?? []) if (!(SEED_VOCAB as readonly string[]).includes(t)) badTag += ` ${c.id}:${t}`
}
ok(badCat === "", "expect.category values are real segments", badCat.trim())
ok(badStatus === "", "expect.status values valid for their segment", badStatus.trim())
ok(badTag === "", "expect.mustTagAny tags exist in the seed vocab", badTag.trim())
const sensitiveSeed = SEED_VOCAB.filter((t) => SENSITIVE_TAG.test(t))
ok(sensitiveSeed.length === 0, "seed vocab carries no sensitive tag", sensitiveSeed.join(","))
ok(INBOX_CATEGORIES.length === 4, "segment partition unchanged (general/prayer/question/outreach)")

console.log(fails.length ? `\nFAILED (${fails.length}):\n  - ${fails.join("\n  - ")}` : "\nAll sync checks pass.")
process.exit(fails.length ? 1 : 0)
