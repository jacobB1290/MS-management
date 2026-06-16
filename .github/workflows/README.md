# GitHub Actions workflows

## Workflows

- **`ci.yml`** — runs on every pull request and push to `main`. Installs
  deps, runs `typecheck`, `lint`, `sim:verify` (asserts the outreach-sim
  harness + demo dataset are still in sync with the CRM's AI guards), and
  `build`; a separate non-blocking job runs the Playwright visual harness
  across the full viewport matrix and uploads `playwright-report/` as an
  artifact on failure so visual diffs are reviewable in the Actions UI.

CI is the **only** workflow here. Every scheduled job now runs on **Supabase
pg_cron** instead of GitHub Actions — the repo carries no Actions secrets, so the
old `schedule:` workflows silently skipped every tick. The cron surface lives in
migrations:

| Job | Migration | Cadence | Does |
| --- | --------- | ------- | ---- |
| `gmail-mirror-poll` | `0033` | every minute | Mirror the support@ Gmail mailbox into the CRM (`/api/cron/gmail`). |
| `campaign-worker-poll` | `0034` | every minute | Advance sending SMS/email campaigns (`/api/cron/send-campaign-batch`). |
| `heartbeat-keepalive` | `0035` | daily 09:00 UTC | Bump `heartbeat.last_run_at` (internal `UPDATE`, no HTTP) so the free-tier project stays warm. |
| `knowledge-sync-poll` | `0035` | daily 09:30 UTC | Refresh the AI church facts from ms.church (`/api/cron/sync-knowledge`). |

The HTTP jobs read the app URL + `CRON_SECRET` from Supabase Vault
(`app_base_url`, `cron_secret`) and send them as a bearer token; `CRON_SECRET`
must also be on the Vercel **Production** scope so the endpoints accept the call.
See `docs/brevo-email-setup-runbook.md` for the one-time Vault setup.

## Required secrets

Set these in repo settings (or via `gh secret set <NAME>`) — only CI needs them
now:

| Secret                                  | Used by | Notes                                          |
| --------------------------------------- | ------- | ---------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | ci      | `https://nhrgbjkiiqpzwdgsvdrl.supabase.co`; exposed to Next.js at build. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | ci      | Anon key; exposed to Next.js at build.         |

## Setting secrets

```
gh secret set NEXT_PUBLIC_SUPABASE_URL --body "https://nhrgbjkiiqpzwdgsvdrl.supabase.co"
gh secret set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY --body "<anon key>"
```

Or set them via Settings -> Secrets and variables -> Actions in the GitHub UI.

The service role key never leaves the Next.js server environment — never paste it
into a client component, never commit it.
