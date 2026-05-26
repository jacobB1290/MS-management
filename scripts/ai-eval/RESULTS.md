# Prompt eval sweep — results & model decisions

Date: 2026-05-26. Battery: `scenarios.ts` (58 scenarios: easy happy-paths + a hard
set of ambiguous, multi-message, sarcasm, negation, sensitive-data, injection,
and campaign-nuance cases).

## Method

This container had no inference key, so the sweep used summonable Claude Code
agents pinned to `haiku` and `sonnet` as the inference engine: each agent
received the verbatim production system prompt + the scenario inputs (never the
expected answers) and returned structured JSON, graded against `scenarios.ts`
with the same guards the app applies (crisis floor, 0.75 segment-confidence
floor, sensitive-tag filter, 0.85 opt-out floor).

Caveat: an agent pinned to a tier is a strong proxy for that model's capability
but not a byte-identical raw API call, and scenarios were batched (one risk this
exposed: on one hard notes case Haiku bled a name across batched items — a
non-issue in production where each call is isolated, but consistent with Haiku's
weaker context isolation). Re-run against the live API with `run.ts` to confirm.

## Scores (after prompt hardening)

| Feature | Haiku easy | Haiku hard | Sonnet easy | Sonnet hard | Ship |
|---|---|---|---|---|---|
| triage  | 17/17 | 7/7 | 16/17 | 4/7 | **Haiku** |
| tagging | 13/13 | 5/5 | 13/13 | 5/5 | **Haiku** |
| optout  | 16/16 | 7/7 | 16/16 | 7/7 | **Haiku** |
| notes   | 10/10 | 2/4 | 10/10 | 4/4 | **Sonnet** |

## What the hard set surfaced

- **triage → Haiku.** Haiku actually beat Sonnet on the hard set: on borderline
  cases (sarcasm-wrapped question, soft distress that evades the crisis regex)
  Sonnet's lower confidence tripped the 0.75 floor down to General, while Haiku
  classified them correctly and kept the soft-distress message in Prayer (so a
  hurting person isn't left only in the catch-all). Safe either way; Haiku sorts
  more helpfully and is far cheaper.
- **optout → Haiku, after a prompt fix.** v1 Haiku wrongly read *"stop the daily
  devotionals but I still want event invites"* as a GLOBAL opt-out (would
  suppress a contact who wants to be reached). Added explicit rules for
  partial/content-specific, conditional, and negated phrasing. Re-test: Haiku
  7/7, matching Sonnet. The prompt, not the model, was the gap.
- **tagging → Haiku, after a prompt fix.** Haiku tagged `kids-ministry` for a
  *teenager* (wrong campaign segment). Added an age-group + stopped-role +
  sarcasm precision rule. Re-test: Haiku 5/5.
- **notes → Sonnet.** The decisive split. On the hard set Haiku dropped an
  existing spouse name while merging a long note (and missed the new fact), and
  leaked sensitive marital detail; Sonnet preserved every fact and minimized to
  "asked for prayer." Notes is the one background task where a slip loses staff
  data or leaks PII, so it gets the stronger model. Prompt also hardened with a
  life-change update rule and a sensitive-struggle minimization rule (helps both
  models).

## Decisions written to code

`src/lib/ai-models.ts` AI_DEFAULTS: triage/tagging/optout = Haiku (low),
notes = Sonnet (low), drafting = Sonnet (medium, unchanged). All switchable in
Settings with no redeploy. Prompt fixes live in `src/server/ai/prompts.ts`.

Re-run after any prompt change: `npx tsx scripts/ai-eval/run.ts` (see README).
