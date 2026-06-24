/**
 * segment-pump — run the sermon segmentation SYSTEM without the metered
 * Anthropic API. A Claude Code session is the model: it reads a service
 * transcript and produces the structured result itself, and this tool supplies
 * the EXACT prompt and runs the EXACT schema validation + boundary repair the
 * live API path uses (imported from src/server/ai/segmentContract), so the
 * persisted output is byte-identical to an API run.
 *
 * This tool is pure + credential-free (it never touches the DB or a provider).
 * The session does the DB read (transcript in) and write (result out) through
 * the Supabase MCP. Full runbook: docs/claude-segment-pump.md.
 *
 *   tsx scripts/segment/pump.ts prompt
 *   tsx scripts/segment/pump.ts schema
 *   tsx scripts/segment/pump.ts pull <input.json>            # {durationSec, knownTopics[], transcript}
 *   tsx scripts/segment/pump.ts finalize <raw.json> <durationSec>
 */
import { readFileSync } from "node:fs"
import {
  SYSTEM_PROMPT,
  JSON_SCHEMA,
  ResultSchema,
  buildSegmentUserContent,
  finalizeSegmentation,
} from "../../src/server/ai/segmentContract"

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    return die(`Cannot read/parse ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const [cmd, a1, a2] = process.argv.slice(2)

if (cmd === "prompt") {
  console.log(SYSTEM_PROMPT)
} else if (cmd === "schema") {
  console.log(JSON.stringify(JSON_SCHEMA, null, 2))
} else if (cmd === "pull") {
  if (!a1) die("usage: pull <input.json>   input = {durationSec, knownTopics[], transcript}")
  const i = readJson(a1) as { durationSec?: number; knownTopics?: string[]; transcript?: string }
  if (typeof i.durationSec !== "number" || typeof i.transcript !== "string") {
    die("input.json needs a numeric `durationSec` and a string `transcript` (knownTopics[] optional)")
  }
  const user = buildSegmentUserContent(i.durationSec, i.knownTopics ?? [], i.transcript)
  console.log("========== SYSTEM ==========\n")
  console.log(SYSTEM_PROMPT)
  console.log("\n========== USER ==========\n")
  console.log(user)
  console.log("\n========== TASK ==========")
  console.log(
    "Read the transcript above and respond with ONLY a JSON object matching this schema (no prose, no markdown fence):\n",
  )
  console.log(JSON.stringify(JSON_SCHEMA, null, 2))
} else if (cmd === "finalize") {
  if (!a1 || a2 === undefined) die("usage: finalize <raw-result.json> <durationSec>")
  const durationSec = Number(a2)
  if (!Number.isFinite(durationSec) || durationSec < 0) die("durationSec must be a non-negative number")
  const checked = ResultSchema.safeParse(readJson(a1))
  if (!checked.success) {
    die("Result JSON does not match the schema:\n" + JSON.stringify(checked.error.issues, null, 2))
  }
  // Same repair the live API path runs -> identical persisted shape.
  const data = finalizeSegmentation(checked.data, durationSec)
  console.log(JSON.stringify(data, null, 2))
} else {
  die("commands:\n  prompt\n  schema\n  pull <input.json>\n  finalize <raw.json> <durationSec>")
}
