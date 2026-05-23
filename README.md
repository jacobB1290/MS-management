# MS Management

Internal CRM + two-way SMS + email engine for Morning Star Christian Church.
Pair to the public `ms.church` website; staff-only, behind auth.

See **`CLAUDE.md`** for the working agreement (architecture, security rules,
compliance, design language, conventions). New to this repo? Read that first.

## Quick start

```bash
npm install
cp .env.example .env.local       # fill in Supabase + provider keys
npm run dev                      # http://localhost:3000
```

Twilio and SendGrid keys are optional during development. Without them, the
send pipeline runs in **mock mode**: messages are recorded in the DB with
`status = 'mocked'` and the UI behaves exactly as if they sent. Drop in real
keys and it sends real messages — no code change.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (runs `tsc --noEmit` first) |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint |
| `npm run harness` | Playwright visual harness (multi-viewport screenshots) |
| `npm run harness:update` | Update baseline screenshots after intentional changes |

## Repository layout

```
src/
  app/                   # Next.js App Router pages + route handlers
  components/            # UI primitives + composed components
  design/                # Typed view of design tokens
  lib/                   # Cross-cutting utilities (incl. Supabase clients)
  server/                # Server-only modules (no "use client")
    comms/               # sendSms, sendEmail (canonical send paths)
    validation/          # Zod schemas, phone normalization
    webhooks/            # Provider signature verification
supabase/
  migrations/            # Versioned SQL (the only way to change schema)
  functions/             # Edge functions
scripts/harness/         # Playwright visual regression suite
.github/workflows/       # CI + cron heartbeat
```

## Tech

Next.js 16 · React 19 · Tailwind v4 · Supabase (Postgres + Auth + Realtime)
· Twilio · SendGrid · Playwright. TypeScript strict throughout.
