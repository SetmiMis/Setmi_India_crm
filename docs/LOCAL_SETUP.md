# Local setup (Windows)

## Prerequisites

* Git for Windows, Node.js **20.9+** (22 LTS recommended; developed on 24.x), npm 10+.
* No Docker is required for development or tests: database tests run on **PGlite** (Postgres 17 in
  WebAssembly) inside Node.
* A Supabase project for running the app against real data (dev/staging — never production for
  experiments).

## Install

```bash
git clone https://github.com/SetmiMis/Setmi_India_crm
cd Setmi_India_crm/web
npm ci
```

## Environment

Copy `web/.env.example` to `web/.env.local` and fill in values (never commit it). For UI-only
preview without a database, dummy values work: pages render, data features show errors.

## Database (dev/staging project)

1. Apply migrations in order from `supabase/migrations/` (Supabase CLI `supabase db push`, or paste
   each file into the SQL editor in order), then `supabase/seed/01_reference.sql`.
2. Supabase Auth → URL configuration: Site URL = `APP_BASE_URL`; add
   `<APP_BASE_URL>/auth/confirm` to redirect URLs.
3. Put the project URL, publishable key and **secret key** in `web/.env.local`, then:

```bash
npm run seed:reference                       # 36 states + 19,238 pincodes (idempotent)
npx tsx --env-file=.env.local scripts/bootstrap-admin.ts --email owner@example.com --username owner --name "Owner Name"
npm run e2e:accounts                         # optional: synthetic e2e.admin / e2e.rep1 / e2e.rep2
```

   The admin's password is random and never printed — set it via *Forgot password* on the login page.

Further users are created from **Users & Team** in the app.

## Run

```bash
npm run dev          # http://localhost:3000
npm run build        # production build (+ copies static assets into .next/standalone)
npm start            # runs .next/standalone/server.js (set PORT if needed)
```

Stop with `Ctrl+C`. If port 3000 stays busy: `Get-NetTCPConnection -LocalPort 3000` → `Stop-Process -Id <pid>`.

## Checks

```bash
npm run lint && npm run typecheck
npm run test:unit
npm run test:db      # migrations + RLS + workflows on PGlite (~20 s)
npm run ci           # everything, including the build
```

Legacy checks (repo root): `npm run ci`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid or missing environment variables: …` | fill `.env.local`; names only are printed, never values |
| Login says "temporarily unavailable" | database not reachable (rate limiter fails closed) |
| `next/font` or CSS errors after config changes | stop the dev server, delete `web/.next`, restart |
| Tests: `extension "pg_trgm" is not available` | run tests through `npm run test:db` (harness loads the extension) |
