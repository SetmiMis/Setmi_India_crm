# Changelog

## [Unreleased] — feat/production-crm-modernization

### Added
- New CRM in `web/` (Next.js 16, TypeScript strict, Tailwind 4) with every legacy module, SETMI INDIA
  branding (palette, Chakra Petch / Plus Jakarta Sans), responsive layout and dark mode.
- Supabase schema in `supabase/migrations/` (7 migrations): constraints, indexes, RLS on every table,
  transactional SECURITY DEFINER RPCs, audit log, private document bucket; reference seed (36 states,
  19,238 pincodes) generated from the legacy source.
- Supabase Auth (username or email login, password reset, TOTP MFA, session revocation),
  admin user management.
- Public enquiry form, PII-free share links (hashed, expiring, revocable), counts-only metrics feed
  with rotatable key, CSV exports with formula-injection protection.
- Integrations: OMS adapter (two-phase, idempotent), Meta Ads import (file + Google Sheet job),
  SMTP daily digest, pincode lookup proxy.
- Migration tooling (`web/scripts/migrate.ts`): dry-run report, row-level issues, idempotent load,
  reconciliation.
- Tests: 20 unit, 51 database (rules, RLS allow/deny, workflows, migration) on PGlite; CI job for
  `web/`; secret scanner rules for Supabase keys, JWTs and DB URLs.
- Docs: baseline assessment, architecture, schema, security, migration, setup, testing, Hostinger
  deployment, operations, user guide, API contracts, ADRs, progress checklist.

### Deployed to the database (2026-10-23, owner-approved)
- Migrations 0100–0700 + reference seed applied to Supabase `nhhlewvvqsfcbstukzul`; first admin created;
  Playwright E2E 10/10 on the live project. App not yet deployed to Hostinger; no legacy data migrated.

### Changed (behaviour differences from the legacy app, by design)
- Stage transitions are validated; Lost needs a reason; only admins re-open Lost.
- Only admins approve/reject pending leads; reps hand over leads via Transfer (no direct reassignment).
- Meta leads default to Pending Approvals (configurable); new source value "Meta Ads".
- Reps see only customers of their own leads; call logs require ownership; employee comes from the session.
- Public form no longer reveals whether a phone already exists.
- Daily digest email omits phone numbers.

### Fixed (legacy defects, by construction)
BUG-002, 003, 004, 005, 006, 007, 009, 010, 011, 016 (migration), 017, 018, 019, 020, 021.

### Legacy (`src/`, root tooling)
- `npm test` now runs on Windows (`scripts/run-tests.js` sets TZ portably). No change to `src/`.
