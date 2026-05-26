/**
 * Offline prompt-eval runner. Grades a live Claude model against the scenario
 * battery (scenarios.ts) using the EXACT production system prompts and the same
 * deterministic guards (crisis floor, confidence floor, sensitive-tag filter,
 * opt-out confidence floor) the app applies. Prints per-feature pass rates so
 * you can decide Haiku-vs-Sonnet per task and catch prompt regressions.
 *
 * Run (needs ANTHROPIC_API_KEY):
 *   npx tsx scripts/ai-eval/run.ts --model claude-haiku-4-5-20251001
 *   npx tsx scripts/ai-eval/run.ts --feature triage --model claude-sonnet-4-6 --effort low
 *
 * This is a dev tool, not shipped app code; it is intentionally standalone
 * (no Next, no @/ alias) so it runs under plain tsx.
 */
import Anthropic from "@anthropic-ai/sdk"
import {
  TRIAGE_SYSTEM_PROMPT,
  TAGGING_SYSTEM_PROMPT,
  NOTES_SYSTEM_PROMPT,
  OPTOUT_SYSTEM_PROMPT,
  CRISIS,
  SENSITIVE_TAG,
  buildTranscript,
} from "../../src/server/ai/prompts"
import {
  TAG_VOCAB,
  triageScenarios,
  taggingScenarios,
  notesScenarios,
  optoutScenarios,
  type ThreadMsg,
} from "./scenarios"

type Feature = "triage" | "tagging" | "notes" | "optout"
const CONFIDENCE_FLOOR = 0.75
const OPTOUT_FLOOR = 0.85
const LIFECYCLE: Record<string, string[]> = {
  general: [],
  prayer: ["new", "praying", "answered", "archived"],
  question: ["new", "in_progress", "closed"],
  outreach: ["new", "in_progress", "done"],
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const MODEL = arg("model", "claude-haiku-4-5-20251001")
const EFFORT = arg("effort", "low") as "low" | "medium" | "high"
const FEATURE = arg("feature", "all") as Feature | "all"
const supportsEffort = MODEL.startsWith("claude-opus") || MODEL.startsWith("claude-sonnet")

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function callJson(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<unknown> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(supportsEffort ? { thinking: { type: "disabled" as const } } : {}),
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: {
      format: { type: "json_schema", schema },
      ...(supportsEffort ? { effort: EFFORT } : {}),
    },
  })
  const raw = res.content
    .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
  return JSON.parse(raw)
}

const lastInbound = (t: ThreadMsg[]) => [...t].reverse().find((m) => m.direction === "in")
const ci = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase())

type Row = { id: string; pass: boolean; detail: string }

async function runTriage(): Promise<Row[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category: { type: "string", enum: ["general", "prayer", "question", "outreach"] },
      status: { type: ["string", "null"] },
      confidence: { type: "number" },
      rationale: { type: "string" },
    },
    required: ["category", "status", "confidence", "rationale"],
  }
  const rows: Row[] = []
  for (const s of triageScenarios) {
    try {
      let category: string
      let status: string | null
      const li = lastInbound(s.thread)
      if (li && CRISIS.test(li.body)) {
        category = "general"
        status = null
      } else {
        const out = (await callJson(
          TRIAGE_SYSTEM_PROMPT,
          `Recent thread (oldest first):\n${buildTranscript(s.thread)}`,
          schema,
          256,
        )) as { category: string; status: string | null; confidence: number }
        const conf = Math.max(0, Math.min(1, out.confidence))
        category = conf >= CONFIDENCE_FLOOR ? out.category : "general"
        const valid = LIFECYCLE[category] ?? []
        status = valid.length === 0 ? null : out.status && valid.includes(out.status) ? out.status : valid[0]
      }
      const catOk = category === s.expect.category
      const statusOk = s.expect.status === undefined || status === s.expect.status
      rows.push({
        id: s.id,
        pass: catOk && statusOk,
        detail: `got ${category}/${status ?? "—"} want ${s.expect.category}/${s.expect.status ?? "—"}`,
      })
    } catch (e) {
      rows.push({ id: s.id, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return rows
}

async function runTagging(): Promise<Row[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      existing_tags: { type: "array", items: { type: "string" } },
      proposed_tag: { type: ["string", "null"] },
      rationale: { type: "string" },
    },
    required: ["existing_tags", "proposed_tag", "rationale"],
  }
  const vocab = new Set<string>(TAG_VOCAB)
  const rows: Row[] = []
  for (const s of taggingScenarios) {
    try {
      const out = (await callJson(
        TAGGING_SYSTEM_PROMPT,
        [
          `Existing tag vocabulary (choose only from these for existing_tags):\n${TAG_VOCAB.join(", ")}`,
          `Tags already on this contact: (none)`,
          `Recent thread (oldest first):\n${buildTranscript(s.thread)}`,
        ].join("\n\n"),
        schema,
        512,
      )) as { existing_tags: string[]; proposed_tag: string | null }
      const tags = [
        ...out.existing_tags.filter((t) => vocab.has(t)),
        ...(out.proposed_tag && !SENSITIVE_TAG.test(out.proposed_tag) ? [out.proposed_tag] : []),
      ]
      const e = s.expect
      let pass = true
      const why: string[] = []
      if (e.mustInclude) for (const t of e.mustInclude) if (!tags.includes(t)) { pass = false; why.push(`missing ${t}`) }
      if (e.mustIncludeAny && !e.mustIncludeAny.some((t) => tags.includes(t))) { pass = false; why.push(`none of ${e.mustIncludeAny.join("|")}`) }
      if (e.mustNotInclude) for (const t of e.mustNotInclude) if (tags.some((x) => ci(x, t))) { pass = false; why.push(`has forbidden ${t}`) }
      rows.push({ id: s.id, pass, detail: `[${tags.join(", ")}] ${why.join("; ")}` })
    } catch (e) {
      rows.push({ id: s.id, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return rows
}

async function runNotes(): Promise<Row[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { notes: { type: "string" } },
    required: ["notes"],
  }
  const rows: Row[] = []
  for (const s of notesScenarios) {
    try {
      const out = (await callJson(
        NOTES_SYSTEM_PROMPT,
        [`Current notes:\n${s.current || "(none yet)"}`, `Recent thread (oldest first):\n${buildTranscript(s.thread)}`].join("\n\n"),
        schema,
        700,
      )) as { notes: string }
      let notes = out.notes.trim()
      if (!notes && s.current) notes = s.current // app guard: never wipe
      const e = s.expect
      let pass = true
      const why: string[] = []
      if (e.mustContainAll) for (const t of e.mustContainAll) if (!ci(notes, t)) { pass = false; why.push(`missing ${t}`) }
      if (e.mustContainAny && !e.mustContainAny.some((t) => ci(notes, t))) { pass = false; why.push(`none of ${e.mustContainAny.join("|")}`) }
      if (e.mustPreserve) for (const t of e.mustPreserve) if (!ci(notes, t)) { pass = false; why.push(`dropped ${t}`) }
      if (e.shouldNotContain) for (const t of e.shouldNotContain) if (ci(notes, t)) { pass = false; why.push(`leaked ${t}`) }
      rows.push({ id: s.id, pass, detail: why.length ? why.join("; ") : "ok" })
    } catch (e) {
      rows.push({ id: s.id, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return rows
}

async function runOptout(): Promise<Row[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      opt_out: { type: "boolean" },
      confidence: { type: "number" },
      rationale: { type: "string" },
    },
    required: ["opt_out", "confidence", "rationale"],
  }
  const rows: Row[] = []
  for (const s of optoutScenarios) {
    try {
      const out = (await callJson(
        OPTOUT_SYSTEM_PROMPT,
        `Recent thread (oldest first):\n${buildTranscript(s.thread)}`,
        schema,
        128,
      )) as { opt_out: boolean; confidence: number }
      const fired = out.opt_out && Math.max(0, Math.min(1, out.confidence)) >= OPTOUT_FLOOR
      rows.push({ id: s.id, pass: fired === s.expect, detail: `got ${fired} (conf ${out.confidence}) want ${s.expect}` })
    } catch (e) {
      rows.push({ id: s.id, pass: false, detail: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  return rows
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. See scripts/ai-eval/README.md.")
    process.exit(1)
  }
  console.log(`\nModel: ${MODEL}${supportsEffort ? ` (effort ${EFFORT})` : ""}\n`)
  const runners: Record<Feature, () => Promise<Row[]>> = {
    triage: runTriage,
    tagging: runTagging,
    notes: runNotes,
    optout: runOptout,
  }
  const features = FEATURE === "all" ? (Object.keys(runners) as Feature[]) : [FEATURE]
  let grand = 0
  let grandTotal = 0
  for (const f of features) {
    const rows = await runners[f]()
    const passed = rows.filter((r) => r.pass).length
    grand += passed
    grandTotal += rows.length
    console.log(`== ${f}: ${passed}/${rows.length} ==`)
    for (const r of rows) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`)
    console.log("")
  }
  console.log(`TOTAL: ${grand}/${grandTotal}`)
}

void main()
