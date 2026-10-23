# Instructions for AI coding agents

This is a live Google Apps Script + Google Sheets CRM. Before any change, read
`docs/09_AI_DEVELOPER_GUIDE.md` (mandatory rules) and the docs it points to, then verify against `src/`.

Key rules:
- Any top-level function in `src/*.js` without a trailing `_` is callable anonymously from the internet.
- Never push/deploy to the production script, edit the live workbook, or change sharing/properties/triggers without explicit approval.
- Never commit secrets, `.clasp.json`/`.clasprc.json`, or real customer data.
- Run `npm run ci` before proposing a change; update docs/03, 05, 07, 08 when behaviour or schema changes.

## New CRM (`web/`, `supabase/`)
- Read `docs/PROGRESS.md` first, then `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.
- `web/` uses Next.js 16 — read `web/AGENTS.md` and `web/node_modules/next/dist/docs/` before using Next APIs.
- Business rules and authorization live in `supabase/migrations/*` (SECURITY DEFINER RPCs + RLS). Never grant
  direct table writes to `authenticated`; never call `serviceClient()` before an explicit authorization check.
- Schema changes = a new migration file + tests in `web/tests/db`. Run `cd web && npm run ci`.
- Never apply migrations to the live Supabase project, deploy, or change DNS without explicit owner approval.
