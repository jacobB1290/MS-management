/**
 * Live engine for the outreach-wave simulation. Runs the four production
 * background-automation prompts over the outreach-sim corpus against the live
 * Claude API and writes the raw model outputs to sim-out-*.json (the exact shape
 * the grader/fixture-gen consume). This is the keyed, one-command alternative to
 * the summoned-agent sweep documented in README.md.
 *
 * STAYS IN SYNC WITH THE CRM: system prompts come from src/server/ai/prompts.ts,
 * the per-feature model + effort from src/lib/ai-models.ts (AI_DEFAULTS), and the
 * category enum from src/lib/inbox-segments.ts — the same definitions production
 * imports. Change a prompt or a model default and this picks it up automatically.
 *
 * Run (needs ANTHROPIC_API_KEY):
 *   npx tsx scripts/ai-eval/sim-run.ts
 *   npx tsx scripts/ai-eval/sim-run.ts --only triage,optout
 */
import { writeFileSync } from "fs"
import Anthropic from "@anthropic-ai/sdk"
import {
  TRIAGE_SYSTEM_PROMPT,
  TAGGING_SYSTEM_PROMPT,
  NOTES_SYSTEM_PROMPT,
  OPTOUT_SYSTEM_PROMPT,
  buildTranscript,
} from "../../src/server/ai/prompts"
import { AI_DEFAULTS, modelSupportsEffort, type AiFeature } from "../../src/lib/ai-models"
import { INBOX_CATEGORIES } from "../../src/lib/inbox-segments"
import { outreachSim, SEED_VOCAB } from "./outreach-sim"

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. See scripts/ai-eval/README.md (or use the agent sweep).")
  process.exit(1)
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const onlyArg = (() => {
  const i = process.argv.indexOf("--only")
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(",")) : null
})()
const want = (task: string) => !onlyArg || onlyArg.has(task)

// C04 = carrier STOP keyword: organize is skipped entirely (handled pre-AI).
// C10 = explicit crisis: triage is rule-floored (no model call); other tasks run.
const SKIP_ALL = new Set(["C04"])
const SKIP_TRIAGE = new Set(["C04", "C10"])

async function callJson(feature: AiFeature, system: string, user: string, schema: Record<string, unknown>, maxTokens: number): Promise<unknown> {
  const { model, effort } = AI_DEFAULTS[feature]
  const supportsEffort = modelSupportsEffort(model)
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(supportsEffort ? { thinking: { type: "disabled" as const } } : {}),
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: {
      format: { type: "json_schema", schema },
      ...(supportsEffort ? { effort } : {}),
    },
  })
  const raw = res.content
    .filter((b): b is { type: "text"; text: string; citations: null } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
  return JSON.parse(raw)
}

const triageSchema = {
  type: "object", additionalProperties: false,
  properties: {
    category: { type: "string", enum: INBOX_CATEGORIES as unknown as string[] },
    status: { type: ["string", "null"] },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["category", "status", "confidence", "rationale"],
}
const tagSchema = {
  type: "object", additionalProperties: false,
  properties: {
    existing_tags: { type: "array", items: { type: "string" } },
    proposed_tag: { type: ["string", "null"] },
    rationale: { type: "string" },
  },
  required: ["existing_tags", "proposed_tag", "rationale"],
}
const notesSchema = { type: "object", additionalProperties: false, properties: { notes: { type: "string" } }, required: ["notes"] }
const optoutSchema = {
  type: "object", additionalProperties: false,
  properties: { opt_out: { type: "boolean" }, confidence: { type: "number" }, rationale: { type: "string" } },
  required: ["opt_out", "confidence", "rationale"],
}

const write = (name: string, rows: unknown[]) => {
  writeFileSync(new URL(`sim-out-${name}.json`, import.meta.url), JSON.stringify(rows, null, 2))
  console.log(`  wrote sim-out-${name}.json (${rows.length} rows)`)
}

async function main() {
  const vocab = SEED_VOCAB.join(", ")
  console.log(`Models: triage/tagging/optout=${AI_DEFAULTS.triage.model}, notes=${AI_DEFAULTS.notes.model}\n`)

  if (want("triage")) {
    const rows: unknown[] = []
    for (const c of outreachSim) {
      if (SKIP_TRIAGE.has(c.id)) continue
      const out = (await callJson("triage", TRIAGE_SYSTEM_PROMPT, `Recent thread (oldest first):\n${buildTranscript(c.thread)}`, triageSchema, 256)) as object
      rows.push({ id: c.id, ...out })
    }
    write("triage", rows)
  }

  if (want("tagging")) {
    const rows: unknown[] = []
    for (const c of outreachSim) {
      if (SKIP_ALL.has(c.id)) continue
      const user = [
        `Existing tag vocabulary (choose only from these for existing_tags):\n${vocab}`,
        `Tags already on this contact: (none)`,
        `Recent thread (oldest first):\n${buildTranscript(c.thread)}`,
      ].join("\n\n")
      const out = (await callJson("tagging", TAGGING_SYSTEM_PROMPT, user, tagSchema, 512)) as object
      rows.push({ id: c.id, ...out })
    }
    write("tagging", rows)
  }

  if (want("optout")) {
    const rows: unknown[] = []
    for (const c of outreachSim) {
      if (SKIP_ALL.has(c.id)) continue
      const out = (await callJson("optout", OPTOUT_SYSTEM_PROMPT, `Recent thread (oldest first):\n${buildTranscript(c.thread)}`, optoutSchema, 128)) as object
      rows.push({ id: c.id, ...out })
    }
    write("optout", rows)
  }

  if (want("notes")) {
    const rows: unknown[] = []
    for (const c of outreachSim) {
      if (SKIP_ALL.has(c.id)) continue
      const user = [`Current notes:\n(none yet)`, `Recent thread (oldest first):\n${buildTranscript(c.thread)}`].join("\n\n")
      const out = (await callJson("notes", NOTES_SYSTEM_PROMPT, user, notesSchema, 700)) as { notes: string }
      rows.push({ id: c.id, notes: out.notes })
    }
    write("notes", rows)
  }

  console.log("\nDone. Next: npm run sim:build  (grade + regenerate the demo dataset).")
}

void main()
