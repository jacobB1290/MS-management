# AI prompt eval harness

Exercises the background-automation system prompts (`src/server/ai/prompts.ts`)
across a battery of realistic scenarios (`scenarios.ts`) and grades the output
with the same deterministic guards the app applies (crisis floor, confidence
floor, sensitive-tag filter, opt-out confidence floor). Use it to choose the
model per task (Haiku vs Sonnet) and to catch prompt regressions before they
ship.

## Run against a live model

Needs `ANTHROPIC_API_KEY` (an inference key). No app install required beyond
the repo's deps.

```bash
# whole battery on Haiku
npx tsx scripts/ai-eval/run.ts --model claude-haiku-4-5-20251001

# one feature on Sonnet
npx tsx scripts/ai-eval/run.ts --feature triage --model claude-sonnet-4-6 --effort low
```

`--feature` is one of `triage | tagging | notes | optout | all` (default `all`).
Output is per-scenario PASS/FAIL plus per-feature and total pass rates.

## Run without a key (what we did here)

This container had no inference key, so the in-session sweep used summonable
Claude Code agents pinned to `haiku` and `sonnet` as the inference engine: each
agent is handed the verbatim system prompt + the scenario inputs and returns the
structured JSON, which is then graded against `scenarios.ts`. The findings and
the resulting per-feature model defaults are recorded in `RESULTS.md`.

## Files

- `scenarios.ts` — the scenario battery + expected outcomes (the source of truth
  for "correct").
- `run.ts` — the live-model runner + graders.
- `RESULTS.md` — the latest sweep findings and the model-default decisions.

When you change a prompt in `src/server/ai/prompts.ts`, re-run the sweep and
update `RESULTS.md`.

---

# Outreach-wave simulation

A standing, re-runnable scenario: a neighborhood card/flyer drop (cards carry
the SMS number + a QR to the website form) produces a 40-conversation /
50-message inbound wave. The wave is run through the four production
auto-systems (opt-out, triage, tagging, notes) and the result is wired into the
demo CRM so you can click through it in demo mode. Full write-up in
`OUTREACH-SIM-RESULTS.md`.

## Quick run

```bash
# 1. Engine — produce the model outputs (sim-out-*.json). Needs ANTHROPIC_API_KEY.
npm run sim                 # all four tasks; or: npm run sim -- --only triage,optout

# 2. Grade + regenerate the demo dataset (no key needed; deterministic).
npm run sim:build           # writes sim-result.json + src/server/demo/fixtures.ts

# 3. Drift guard — fails if anything is out of sync with the CRM.
npm run sim:verify
```

No `ANTHROPIC_API_KEY`? Skip step 1 and use the **agent sweep**: summon Claude
Code agents pinned to the shipping tiers (Haiku for triage/tagging/opt-out,
Sonnet for notes), hand each the verbatim prompt from `src/server/ai/prompts.ts`
plus the corpus transcripts, and have them write `sim-out-<task>.json`. Then run
steps 2–3. This is how the committed snapshot was produced.

## Files

- `outreach-sim.ts` — the corpus: threads + per-conversation human expectations
  + the seed tag vocabulary (`SEED_VOCAB`).
- `sim-run.ts` — live API engine (step 1).
- `sim-assemble.ts` — applies the production guards to the model outputs and
  grades vs expectations; exports `assemble()` and writes `sim-result.json`.
- `sim-gen-fixtures.ts` — regenerates `src/server/demo/fixtures.ts` from
  `sim-result.json`; exports `generate()`.
- `sim-verify.ts` — the drift guard (step 3).
- `sim-out-*.json` — the recorded engine outputs (the run snapshot).
- `sim-result.json` — the effective CRM state after the guards.

## How it stays in sync with the CRM

Nothing about the CRM's behavior is duplicated in the harness — it is imported
from the same modules production uses, so a change there flows through
automatically:

| What | Single source of truth |
|---|---|
| System prompts | `src/server/ai/prompts.ts` |
| Triage + opt-out confidence floors | `src/server/ai/prompts.ts` (`TRIAGE_CONFIDENCE_FLOOR`, `OPTOUT_CONFIDENCE_FLOOR`) |
| Crisis / sensitive-tag regexes | `src/server/ai/prompts.ts` |
| Segment partition + status lifecycle | `src/lib/inbox-segments.ts` |
| Per-feature model + effort | `src/lib/ai-models.ts` (`AI_DEFAULTS`) |

`npm run sim:verify` is the enforcement: it re-applies today's guards to the
recorded outputs and fails if the committed `sim-result.json` or
`src/server/demo/fixtures.ts` no longer matches, telling you to re-run
`npm run sim:build`. Wire it into CI (or a pre-commit hook) so a CRM change can
never silently leave the simulation — or the demo dataset — stale. When you
change a prompt or model default, re-run `npm run sim` then `npm run sim:build`
and commit the refreshed snapshot.
