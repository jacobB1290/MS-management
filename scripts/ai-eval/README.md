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
