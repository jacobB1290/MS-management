# Segmenting services with a Claude Code session (no API)

A way to run the sermon segmentation **system** without spending the metered
Anthropic API: a Claude Code session (or a fleet of Opus subagents) **is the
model**. It reads a service transcript and produces the structured result by
hand; a small pure tool supplies the exact prompt and runs the exact validation
+ boundary repair the live API path uses; the session does the DB read/write
through the Supabase MCP.

This exists because the API has a hard monthly **org spend limit** (`400
invalid_request_error: "You have reached your specified API usage limits"`).
When it's hit, every model call fails until the limit resets or is raised in the
Anthropic Console (Billing → Limits) — switching models does **not** help, the
cap is org-wide. A Code session is billed against your Claude subscription, not
that API limit, so it keeps working.

## The pieces

| Piece | Role |
|---|---|
| `src/server/ai/segmentContract.ts` | The single source of truth: `SYSTEM_PROMPT`, `JSON_SCHEMA`, `ResultSchema`, `buildSegmentUserContent()`, `finalizeSegmentation()`. Pure (no DB, no SDK, no `server-only`). The live API path (`segmentSermon.ts`) and this pipeline both import it, so output is byte-identical. |
| `scripts/segment/pump.ts` | A credential-free CLI over the contract. `prompt` / `schema` print the contract; `pull` builds the exact work packet; `finalize` validates + repairs a result into the persisted shape. Touches nothing external. |
| The session / Opus subagents | The model. Reads the transcript, produces the JSON. |
| Supabase MCP (`mcp__Supabase__execute_sql`, project `nhrgbjkiiqpzwdgsvdrl`) | DB read (transcript in) and write (result out). The session does this; the script never does. |

## Full segmentation (chapters + songs + metadata)

Per designated service:

1. **Read** the inputs from the DB (MCP):
   ```sql
   select id, duration_sec, transcript from public.sermons where id = '<uuid>';
   -- known topics to encourage a shared vocabulary:
   select distinct unnest(topics) as t from public.sermons where status in ('published','review');
   ```
2. **Build the work packet.** Write `{durationSec, knownTopics, transcript}` to a
   file and run `tsx scripts/segment/pump.ts pull input.json`. It prints the
   SYSTEM prompt + the USER message + the JSON schema to answer with.
3. **Produce** the JSON (the session reasons over the transcript), save it to
   `raw.json`.
4. **Finalize**: `tsx scripts/segment/pump.ts finalize raw.json <durationSec>`.
   This validates against `ResultSchema` and runs the same boundary repair the
   API path runs, printing the DB-ready object (`segments`, `songs`, `summary`,
   `seo`, `title`, `format`, `speakers`, `topics`).
5. **Write** to the DB (MCP), landing at `review` for a human to publish (never
   auto-publish AI output straight to the live site):
   ```sql
   update public.sermons set
     segments = $segments::jsonb, songs = $songs::jsonb, summary = $summary,
     seo = $seo::jsonb, generated_title = $title, format = $format,
     speakers = $speakers, topics = $topics, status = 'review', error = null,
     slug = coalesce(slug, '<slugified-title-date>')
   where id = '<uuid>';
   ```
   Then bulk-publish from the CRM (`/sermons` → review) or
   `update ... set status='published', published_at = coalesce(published_at, now())`.

> **Transcript timestamps.** `finalizeSegmentation` repairs boundaries but cannot
> invent them: good chapter/song times need the **timestamped** transcript
> (`[mm:ss]` cues). The DB stores only the plain transcript, so full
> re-chaptering from the DB alone produces estimated times. For accurate
> chapters either (a) feed a timestamped transcript (re-fetch the YouTube
> captions where OAuth is configured), or (b) only run a metadata pass (below)
> on services that already have good `segments`.

## Metadata-only pass (titles etc. — keeps existing chapters)

Most back-catalog services are already chaptered and just lack a
`generated_title` (or `format`/`speakers`/`topics`). The title is
timestamp-independent, so a plain transcript is enough and you do **not** touch
`segments` or `status`:

1. `select id, summary, format, transcript from public.sermons where id='<uuid>';`
2. Read the transcript, find the **message** (not the welcome, the reading
   reflection, or the songs), and write a title per the "Title" rules in
   `SYSTEM_PROMPT` (3–8 words, Title Case, specific, never the date/"live"/church
   name, curly apostrophe).
3. `update public.sermons set generated_title = $title where id = '<uuid>';`
   (status stays `published`; the public site shows the new title within the
   feed's ~60s cache.)

## Fan out with Opus subagents

Designate N services and spawn **one Opus subagent per service** (in parallel,
`model: "opus"`). Give each the sermon id and have it query its own transcript
via the Supabase MCP and **return** the JSON (don't let subagents write — the
parent validates with `pump finalize` and does the controlled MCP write). This
is the fastest path for a back-catalog batch and keeps each transcript out of
the parent's context. Pattern proven on the Apr–Jun 2026 back-catalog: 7
services titled in two parallel waves, zero API spend.

## Why the bug that prompted this won't recur

A `force` re-run used to walk a published sermon through `transcribing → … →
review` in place, so a failed re-run (e.g. the spend-limit 400) stranded it at
`failed` and dropped it off ms.church. `runSermonPipeline` now captures the
pre-run status and, on failure, restores a `published`/`review` sermon instead
of failing it (`src/server/sermons/service.ts`). A failed re-run leaves the live
content up.
