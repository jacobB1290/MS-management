# GitHub Actions workflows

## Workflows

- **`ci.yml`** — runs on every pull request and push to `main`. Installs
  deps, runs `typecheck`, `lint`, then the Playwright visual harness across
  the full viewport matrix. Uploads `playwright-report/` as an artifact on
  failure so visual diffs are reviewable in the Actions UI.
- **`heartbeat.yml`** — runs daily at 09:00 UTC (and on manual
  `workflow_dispatch`). Reads then patches the `heartbeat` row in Supabase
  to keep the free-tier project warm and to catch credential rot early.

## Required secrets

Set these in repo settings (or via `gh secret set <NAME>`):

| Secret                                  | Used by      | Notes                                                |
| --------------------------------------- | ------------ | ---------------------------------------------------- |
| `SUPABASE_URL`                          | heartbeat    | `https://nhrgbjkiiqpzwdgsvdrl.supabase.co`           |
| `SUPABASE_PUBLISHABLE_KEY`              | heartbeat    | Anon key. Used for the read.                        |
| `SUPABASE_SERVICE_ROLE_KEY`             | heartbeat    | Service role. Used for the PATCH (table has RLS).   |
| `NEXT_PUBLIC_SUPABASE_URL`              | ci           | Same URL as above; exposed to Next.js at build.     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | ci           | Same anon key as above; exposed to Next.js.        |

## Setting secrets

```
gh secret set SUPABASE_URL --body "https://nhrgbjkiiqpzwdgsvdrl.supabase.co"
gh secret set SUPABASE_PUBLISHABLE_KEY --body "<anon key>"
gh secret set SUPABASE_SERVICE_ROLE_KEY --body "<service role key>"
gh secret set NEXT_PUBLIC_SUPABASE_URL --body "https://nhrgbjkiiqpzwdgsvdrl.supabase.co"
gh secret set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY --body "<anon key>"
```

Or set them via Settings -> Secrets and variables -> Actions in the GitHub UI.

The service role key never leaves GitHub Actions or the Next.js server
environment — never paste it into a client component, never commit it.
