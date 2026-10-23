# Testing

## Layers

| Layer | Command | What it proves |
|---|---|---|
| Legacy Apps Script | `npm test` (root) | 27 characterization/contract/security tests for `src/` |
| Unit (TS) | `cd web && npm run test:unit` | dates/IST, cadence, grade, transitions, validation, geo, products, WhatsApp, imports, CSV injection, OMS adapter contract (fake fetch), log redaction |
| Database | `npm run test:db` | migrations apply on a Supabase-like Postgres (PGlite + roles + default privileges); business rules; **RLS allow/deny**; grants; every RPC workflow; data migration |
| Lint / types / build | `npm run lint`, `typecheck`, `build` | static correctness, production bundle |
| End-to-end (Playwright, system Edge) | `npm run e2e:accounts` once, `npm run dev`, then `npm run test:e2e` | real Supabase project: login, intake → approval → claim → call → Quoted/Won/Dispatched/Closed, cross-rep URL denial, transfer, public form → reject, admin pages, rep kept out of admin, CSV scope, headers, health |
| Manual UI smoke | dev or standalone server | login, public form validation, mobile width, headers |

All data is synthetic. Tests never send email (`sendEmail` is disabled under `NODE_ENV=test` and
when SMTP is unset) and never call the OMS or Google.

## Results (2026-10-23, Windows, Node 24.22.1)

| Suite | Result |
|---|---|
| Legacy `npm test` | 27/27 ✅ |
| `test:unit` | 20/20 ✅ |
| `test:db` | 51/51 ✅ (rules 7, security 16, workflows 25, migration 3) |
| `lint`, `typecheck` | clean ✅ |
| `build` | ✅ 34 routes, standalone output |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities ✅ |
| Standalone server smoke | `/login` 200, `/enquiry` 200, `/dashboard` → 307 /login, `/api/export/enquiries` 401, `/api/health` 503 (no DB), CSP with nonce, fonts served ✅ |
| **E2E on live Supabase (2026-10-23)** | **10/10 ✅** (`e2e/crm.spec.ts`, 1.4 min) |
| Browser check | login renders; public form shows field errors and **keeps typed values** (bug found and fixed); no horizontal scroll at 375 px; no console errors ✅ |

**Found and fixed by E2E:** (1) success messages vanished when the affected row left the list
(approve, claim, accept) → app-wide toaster; (2) claim did not navigate to the enquiry for the same
reason → redirect from the action result; (3) district/state stayed empty when a form was submitted
before the browser pincode lookup finished → server fills them from the pincode; (4) the login rate
limiter correctly locked a test account after 8 attempts in 15 minutes (behaviour confirmed, test data reset).

**Not yet run:** performance timings on a large dataset (do this on a copy, not the live project).

## Regression map (legacy rule → test)

| Rule / defect | Test |
|---|---|
| Cadence Hot1/Warm2/Cold6, Sunday + holidays | rules.test, domain.test |
| Grade matrix | rules.test, domain.test |
| Terminal stages clear priority/date | workflows `pipeline…` |
| Won needs invoice (OMS exempt) | workflows `pipeline…`, `OMS…` |
| First call moves New → Follow-up | workflows `log_call is atomic` |
| Approve without owner → Available Leads | workflows `approval without owner` |
| Claim: first wins | workflows `claim` |
| Transfer needs acceptance | workflows `transfer` |
| Rep scoping | security `RLS…`, `dashboard…` |
| BUG-002 archive columns | workflows `archive`, migration test |
| BUG-003 duplicate ids | constraints + migration test |
| BUG-004 lost update | workflows `stale version rejected` |
| BUG-005 id wrap | rules `codes … do not wrap` |
| BUG-006 Qty/Timeline in pending | workflows `pending stores Qty/Timeline` |
| BUG-007 Meta dedup incl. archive | workflows `Meta import` |
| BUG-009 stage validation | rules transitions, workflows `Cannot move` |
| BUG-010/011 reassignment/approval | security tests |
| BUG-017 reviewer identity | workflows `records the submitter` |
| BUG-018 quote/order value writers | workflows `pipeline…` |
| BUG-019/020 ownership on calls/reads | security tests |

## Planned (needs a database)

* Playwright: login → claim → log call → quote → won → dispatch → close; approval flow; rep cannot
  open another rep's URL; mobile navigation.
* Performance: 50k synthetic enquiries; record p50/p95 for dashboard, pipeline page, follow-ups.
