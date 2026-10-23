# Modernization progress checklist

Resume here after a context limit or in a new session: read this file, then `git log`, then run
`cd web && npm run ci`.

**Branch:** `feat/production-crm-modernization` · **Last updated:** 2026-10-23

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 0 Baseline & risk audit | ✅ | docs/BASELINE_ASSESSMENT.md |
| 1 Architecture & security design | ✅ | ARCHITECTURE, SECURITY, DATABASE_SCHEMA, ADR/0001–0006 |
| 2 Foundation (Next 16, TS strict, Tailwind, env validation, errors, tests) | ✅ | `web/` |
| 3 Database & auth (migrations, RLS, RPCs, Supabase Auth, MFA) | ✅ applied to Supabase `nhhlewvvqsfcbstukzul` on 2026-10-23 (8 migrations + reference seed); verified grants/RLS live | `supabase/migrations`, tests/db |
| 4 Core CRM modules | ✅ built · ✅ core flows verified end-to-end on the real DB (Playwright 10/10) | see module table |
| 5 Imports & integrations | ✅ built · ⏳ live OMS / Google / SMTP unverified | |
| 6 Testing & hardening | ✅ unit 20, DB 51, E2E 10 (real Supabase), lint/types/build/audit clean · ⏳ performance | docs/TESTING.md |
| 7 Staging | ⛔ needs Hostinger plan + subdomain (database is ready) | DEPLOYMENT_HOSTINGER.md |
| 8 Migration rehearsal | ⛔ needs sheet exports + staging DB | DATA_MIGRATION.md |
| 9 Handover | 🔄 docs written; final report pending staging | |

## Module coverage (legacy → new)

| # | Module | New route / function | State |
|---|---|---|---|
| 1 | Dashboard + KPIs + funnel + charts | `/dashboard`, `dashboard()` | ✅ |
| 2 | Follow-ups | `/follow-ups`, `follow_ups_due()` | ✅ |
| 3 | Available Leads / claim | `/leads`, `claim_enquiry` | ✅ |
| 4 | Pipeline + filters + export | `/pipeline`, `/api/export/enquiries` | ✅ |
| 5 | Customers | `/customers` | ✅ |
| 6 | New Enquiry (+PDF, autofill, dup warning) | `/new-enquiry` | ✅ |
| 7 | Pending Approvals | `/approvals` | ✅ (admin-only approval) |
| 8 | Reports | `/reports` + CSV | ✅ (replaces "Report Mon yyyy" sheet) |
| 9 | Team Performance | `/team-performance` | ✅ |
| 10 | Users & Team | `/users` | ✅ |
| 11 | MAP Analytics | `/map` | ✅ (pincode/state centroids; live Nominatim district geocoding not ported) |
| 12 | Data Analysis + Won customers | `/analysis` | ✅ |
| 13 | How it Works | `/guide` | ✅ |
| 14 | Public enquiry page | `/enquiry` | ✅ |
| 15 | Public analysis share | `/share/analysis/[token]` | ✅ |
| 16 | Public metrics feed | `/api/public/metrics` | ✅ |
| 17 | Bulk import | `/import` | ✅ |
| 18 | Call management | enquiry page + `/calls` | ✅ |
| 19 | Meta Ads import | `/import` (file), Sheet job `/api/cron/meta-import` | ✅ · Sheet path unverified |
| 20 | OMS bridge | enquiry page OMS panel | ✅ · unverified live |
| 21 | Daily digest | `/api/cron/daily-digest` | ✅ · SMTP unverified |
| 22 | Lead transfer | enquiry page + pipeline | ✅ |
| 23 | Archive / restore / soft delete | admin settings, enquiry page | ✅ |
| 24 | Customer & team maintenance | customers, users | ✅ |
| 25 | Grade, escalation, cadence | DB functions | ✅ |
| 26 | WhatsApp welcome/follow-up links | enquiry, follow-ups, leads | ✅ |
| — | Order FMS Google Form prefilled link | — | ❌ not ported (PII in URL; confirm the form is still used — Q6) |
| — | Sheets menu data-quality tools (state-from-city geocoding, reconcile, debug) | — | ❌ not ported (sheet-specific; replaced by DB constraints + migration report) |
| — | Holidays, settings, audit trail, job monitor, MFA, dark mode | new | ✅ |

## Live Supabase state (2026-10-23)

* Project `nhhlewvvqsfcbstukzul`: migrations 0100–0700 applied; 36 states + 19,238 pincodes seeded.
* Live checks: 16 public tables all RLS-enabled; `anon` has 0 table grants and 0 executable functions;
  `authenticated` has no write grants; no server-only function exposed; document bucket private.
* Advisors: security WARN "authenticated can execute SECURITY DEFINER" ×46 — intentional (ADR-0003, each
  function authorizes itself); INFO `external_lead_refs` has no policy — intentional (server only).
  Performance: FK indexes added (0700); "unused index" notices are expected on an empty database.
* Accounts: first admin `mis` (mis@setmiindia.org; password to be set via *Forgot password*).
  Synthetic test accounts `e2e.admin`, `e2e.rep1`, `e2e.rep2` (passwords only in `web/.env.local`).
* Synthetic records named "E2E TEST …" exist from the E2E runs — remove before go-live
  (owner approval needed; see OPERATIONS_AND_MAINTENANCE.md).

## Next concrete tasks

1. Owner: set your password (login page → Forgot password → mis@setmiindia.org). Configure Supabase Auth
   Site URL / redirect URLs and disable public sign-ups before deploying.
2. Hostinger: confirm plan + subdomain; deploy staging; smoke test.
3. Owner exports → migration dry run → review report → rehearsal (on a Supabase branch/copy).
4. Performance test with 50k synthetic enquiries (on a copy, not the live project).
5. Answer open questions Q2–Q8 (BASELINE_ASSESSMENT §9). Clean up E2E test data + accounts before go-live.
