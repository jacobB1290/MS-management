/**
 * Assemble + grade the outreach-wave simulation.
 *
 * Takes the four engine outputs (sim-out-*.json) — produced either by the live
 * runner (sim-run.ts) or by summoned Haiku/Sonnet agents — and runs them through
 * the EXACT deterministic guards the app applies in src/server/ai (crisis floor,
 * triage confidence floor, status coercion, opt-out floor, sensitive-tag +
 * vocabulary filter). Emits the final per-contact CRM state (sim-result.json)
 * and a pass/fail grade vs. the human expectations colocated in outreach-sim.ts.
 *
 * STAYS IN SYNC WITH THE CRM: the floors come from src/server/ai/prompts.ts and
 * the category lifecycle from src/lib/inbox-segments.ts — the same definitions
 * the production code imports. Nothing here is hardcoded, so a change to either
 * is picked up automatically (and sim-verify.ts asserts it).
 *
 * Run: npx tsx scripts/ai-eval/sim-assemble.ts   (writes sim-result.json)
 */
import { readFileSync, writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { outreachSim, SEED_VOCAB, type Category } from "./outreach-sim"
import {
  CRISIS,
  SENSITIVE_TAG,
  TRIAGE_CONFIDENCE_FLOOR,
  OPTOUT_CONFIDENCE_FLOOR,
} from "../../src/server/ai/prompts"
import { INBOX_CATEGORIES, CATEGORY_STATUS } from "../../src/lib/inbox-segments"

/** Per-category lifecycle, derived from the app's single source of truth. */
const LIFECYCLE: Record<string, string[]> = Object.fromEntries(
  INBOX_CATEGORIES.map((c) => [c, CATEGORY_STATUS[c].map((s) => s.value)]),
)
const VOCAB = new Set<string>(SEED_VOCAB)

export type Final = {
  id: string; name: string | null; phone: string; email: string | null; language: string; channel: string
  category: Category; status: string | null; crisis: boolean; byRule: boolean; triageConf: number | null
  tags: string[]; notes: string; optedOut: boolean; optOutSource: string | null
}

export type GradeRow = { id: string; checks: { name: string; pass: boolean; detail: string }[] }
export type AssembleResult = { finals: Final[]; grades: GradeRow[]; passed: number; total: number; fails: string[] }

const read = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"))
const by = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
const ci = (h: string, n: string) => h.toLowerCase().includes(n.toLowerCase())

function resolveStatus(category: Category, status: string | null): string | null {
  const valid = LIFECYCLE[category]
  if (valid.length === 0) return null
  if (status && valid.includes(status)) return status
  return valid[0]
}

/** Pure: read the four engine outputs, apply the production guards, grade. */
export function assemble(): AssembleResult {
  const triageRaw = read("sim-out-triage.json") as { id: string; category: string; status: string | null; confidence: number }[]
  const optoutRaw = read("sim-out-optout.json") as { id: string; opt_out: boolean; confidence: number }[]
  const tagRaw = read("sim-out-tagging.json") as { id: string; existing_tags: string[]; proposed_tag: string | null }[]
  const notesRaw = read("sim-out-notes.json") as { id: string; notes: string }[]
  const T = by(triageRaw), O = by(optoutRaw), G = by(tagRaw), N = by(notesRaw)
  const lastInbound = (id: string) => [...outreachSim.find((c) => c.id === id)!.thread].reverse().find((m) => m.direction === "in")

  const finals: Final[] = []
  for (const c of outreachSim) {
    const isKeywordStop = c.id === "C04"

    // --- Opt-out: carrier keyword first, then model ≥ floor. ---
    let optedOut = false
    let optOutSource: string | null = null
    if (isKeywordStop) { optedOut = true; optOutSource = "carrier_keyword" }
    else {
      const o = O.get(c.id)
      if (o?.opt_out && o.confidence >= OPTOUT_CONFIDENCE_FLOOR) { optedOut = true; optOutSource = "ai_natural_language" }
    }

    // --- Triage: crisis rule floor → confidence floor → status coercion. ---
    let category: Category = "general"
    let status: string | null = null
    let crisis = false
    let byRule = false
    let triageConf: number | null = null
    const li = lastInbound(c.id)
    if (isKeywordStop) {
      byRule = true // organize is skipped for control replies; stays General.
    } else if (li && CRISIS.test(li.body)) {
      category = "general"; status = null; crisis = true; byRule = true; triageConf = 1
    } else {
      const t = T.get(c.id)
      if (t) {
        triageConf = t.confidence
        const conf = Math.max(0, Math.min(1, t.confidence))
        const cat = (INBOX_CATEGORIES as readonly string[]).includes(t.category) ? (t.category as Category) : "general"
        category = conf >= TRIAGE_CONFIDENCE_FLOOR ? cat : "general"
        status = resolveStatus(category, t.status)
      }
    }

    // --- Tags: vocab + sensitive filter (organize skipped for keyword STOP). ---
    let tags: string[] = []
    if (!isKeywordStop) {
      const g = G.get(c.id)
      if (g) {
        const existing = g.existing_tags.filter((x) => VOCAB.has(x))
        let proposed = g.proposed_tag?.trim() || null
        if (proposed && (VOCAB.has(proposed) || SENSITIVE_TAG.test(proposed))) proposed = null
        tags = Array.from(new Set([...existing, ...(proposed ? [proposed] : [])]))
      }
    }

    // --- Notes (organize skipped for keyword STOP). ---
    let notes = ""
    if (!isKeywordStop) notes = (N.get(c.id)?.notes ?? "").trim()

    finals.push({
      id: c.id, name: c.name, phone: c.phone, email: c.email, language: c.language, channel: c.channel,
      category, status, crisis, byRule, triageConf, tags, notes, optedOut, optOutSource,
    })
  }

  // ---- Grade vs. human expectations ----
  const grades: GradeRow[] = []
  for (const c of outreachSim) {
    const f = finals.find((x) => x.id === c.id)!
    const e = c.expect
    const checks: GradeRow["checks"] = []
    if (e.category !== undefined) checks.push({ name: "category", pass: f.category === e.category, detail: `${f.category} (want ${e.category})` })
    if (e.status !== undefined) checks.push({ name: "status", pass: f.status === e.status, detail: `${f.status ?? "—"} (want ${e.status ?? "—"})` })
    if (e.crisisFloor) checks.push({ name: "crisisFloor", pass: f.crisis === true, detail: `crisis=${f.crisis}` })
    if (e.optOut !== undefined) checks.push({ name: "optOut", pass: f.optedOut === e.optOut, detail: `${f.optedOut} (want ${e.optOut})` })
    if (e.keywordStop) checks.push({ name: "keywordStop", pass: f.optOutSource === "carrier_keyword", detail: `${f.optOutSource}` })
    if (e.mustTagAny) checks.push({ name: "tagAny", pass: e.mustTagAny.some((t) => f.tags.includes(t)), detail: `[${f.tags.join(", ")}] want any of [${e.mustTagAny.join(", ")}]` })
    if (e.mustNotTag) { const bad = e.mustNotTag.filter((t) => f.tags.some((x) => ci(x, t))); checks.push({ name: "tagNot", pass: bad.length === 0, detail: bad.length ? `LEAKED ${bad.join(",")}` : `clean [${f.tags.join(", ")}]` }) }
    if (e.notesMustContainAny) checks.push({ name: "notesAny", pass: e.notesMustContainAny.some((t) => ci(f.notes, t)), detail: e.notesMustContainAny.some((t) => ci(f.notes, t)) ? "ok" : `missing any of [${e.notesMustContainAny.join(", ")}]` })
    if (e.notesMustNotContain) { const bad = e.notesMustNotContain.filter((t) => ci(f.notes, t)); checks.push({ name: "notesNot", pass: bad.length === 0, detail: bad.length ? `LEAKED ${bad.join(",")}` : "clean" }) }
    grades.push({ id: c.id, checks })
  }

  let passed = 0, total = 0
  const fails: string[] = []
  for (const g of grades) for (const c of g.checks) {
    total++
    if (c.pass) passed++
    else fails.push(`${g.id}/${c.name}: ${c.detail}`)
  }
  return { finals, grades, passed, total, fails }
}

function main() {
  const { finals, passed, total, fails } = assemble()
  writeFileSync(new URL("sim-result.json", import.meta.url), JSON.stringify(finals, null, 2))

  const tally = (key: (f: Final) => string) => finals.reduce<Record<string, number>>((a, f) => { const k = key(f); a[k] = (a[k] ?? 0) + 1; return a }, {})
  console.log("=== EFFECTIVE CRM STATE (after production guards) ===")
  console.log("category tally:", tally((f) => f.category))
  console.log("opted out:", finals.filter((f) => f.optedOut).map((f) => `${f.id}(${f.optOutSource})`).join(", "))
  console.log("crisis floored:", finals.filter((f) => f.crisis).map((f) => f.id).join(", "))
  console.log("conf-floored to general:", finals.filter((f) => !f.crisis && f.triageConf !== null && f.triageConf < TRIAGE_CONFIDENCE_FLOOR).map((f) => `${f.id}@${f.triageConf}`).join(", "))
  console.log("contacts with tags:", finals.filter((f) => f.tags.length).length, "/ no tags:", finals.filter((f) => !f.tags.length).length)
  console.log("contacts with notes:", finals.filter((f) => f.notes).length)
  console.log(`\n=== GRADE vs human expectations: ${passed}/${total} checks pass ===`)
  if (fails.length) { console.log("Misses / judgment calls:"); for (const f of fails) console.log("  - " + f) }
  else console.log("All checks pass.")
}

// Run as a CLI; stay importable (sim-verify) without side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
