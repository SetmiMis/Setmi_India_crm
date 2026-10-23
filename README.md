# Setmi_India_crm — SETMI INDIA Sales FMS (Enquiry-to-Order CRM)

This is the source baseline, technical documentation and CI checks for SETMI INDIA's internal
sales CRM. The app runs as a **Google Apps Script web app** with a **Google Sheets** workbook as
its database.

> **Status (2026-10-20): audit baseline.** `src/` is a verbatim export of the production Apps
> Script project, with two credential literals redacted (see [`src/REDACTIONS.md`](src/REDACTIONS.md)).
> **Production is not deployed from this repository yet.** The Apps Script editor is still the
> authoritative source. See [docs/13](docs/13_ENVIRONMENTS_AND_DEPLOYMENT.md) before changing anything.

## What it does

Sales reps capture enquiries (leads) and move them through a pipeline. They schedule and log
follow-up calls and convert enquiries into orders.

`New → Quoted → Follow-up → Won / Lost → Dispatched → Closed`

The modules are: Dashboard, Follow-ups, Available Leads (claim system), Pipeline, Customers, New
Enquiry, Pending Approvals (every new lead is reviewed first), Bulk Import (CSV/Excel), Call
Management, Reports, Team Performance, Users, MAP Analytics and Data Analysis. The app also
includes:

- a public field-capture form (`?page=enquiry`)
- a public analysis share page (`?page=analysis&key=…`)
- a public JSON metrics feed (`?page=metrics&key=…`)
- a bridge to the separate OMS (order management system)
- a Meta Ads leads importer
- a daily digest email

## Technology

| Layer | Technology |
|---|---|
| Server | Google Apps Script (V8 runtime), 8 server files (`src/*.js`) |
| UI | HtmlService templates (`src/Index.html`, `Enquiry.html`, `Share.html`) + 21 included client JS/CSS partials |
| Database | Google Sheets workbook **"E2O FMS"** (script is container-bound to it) |
| Client libs (CDN) | ApexCharts (unversioned), Leaflet 1.9.4, Google Fonts |
| External services | api.postalpincode.in, nominatim.openstreetmap.org, OMS (Vercel), wa.me links, MailApp |
| CI (this repo) | GitHub Actions: structure, syntax, secret scan, Node unit/contract tests |

## Architecture in one picture

```
Browser (rep/admin)            Google Apps Script web app                   Google Sheets "E2O FMS"
Index.html + *.js partials ─▶  doGet() → HtmlService templates               Enquiries, PendingEnquiries,
  google.script.run.fn(token) ─▶ Code.js / CallLog / Analysis / MapAnalytics ─▶ Customers, FollowUps, CallLog,
                              ◀─ JSON-able result                           Users, Team, Archive, Report *
                                  │  CacheService (sessions, row cache)
                                  │  PropertiesService (PIN, keys, OMS cfg)
                                  └─▶ OMS API · postalpincode · Nominatim · MailApp
```

Details: [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md).

## Repository layout

```
src/                 Apps Script project (clasp layout: rootDir = src)
tests/unit/          Node built-in test runner: business-rule characterization + file contracts
tests/helpers/       vm loader that runs src/*.js with stubbed Google services
scripts/             check-structure / check-syntax / check-secrets (no dependencies)
docs/                full technical documentation (index below)
.github/workflows/   ci.yml — validation only, never deploys
```

## Prerequisites and local checks

- Node.js 20+ (no npm dependencies)
- `npm run ci` runs every check that CI runs: structure, syntax, secrets and tests (works on Windows too).
- For syncing with Apps Script, use `@google/clasp`. Set it up **only after** reading
  [docs/13](docs/13_ENVIRONMENTS_AND_DEPLOYMENT.md). `.clasp.json` and `.clasprc.json` are gitignored.

## Development workflow (summary)

1. Branch from `main` (`fix/…`, `feat/…`, `docs/…`).
2. Change `src/`. Run `npm run ci`.
3. Open a PR. CI must pass and one reviewer must approve.
4. After merge, deploy by hand to the **staging** script, run the regression checklist
   ([docs/10](docs/10_TESTING_AND_MAINTENANCE.md)), then promote to production with an approved,
   tagged release ([docs/12](docs/12_CI_CD_AND_RELEASE_PROCESS.md)).

A staging environment does not exist yet. Creating one is a pending decision.

## Documentation index

| # | Document | Contents |
|---|---|---|
| 01 | [System overview](docs/01_SYSTEM_OVERVIEW.md) | business context, users, modules |
| 02 | [Architecture](docs/02_ARCHITECTURE.md) | components, data flow, diagrams |
| 03 | [Database dictionary](docs/03_DATABASE_DICTIONARY.md) | every sheet, column, relationship |
| 04 | [Codebase reference](docs/04_CODEBASE_REFERENCE.md) | file inventory, functions, dependency map |
| 05 | [Modules & workflows](docs/05_MODULES_AND_WORKFLOWS.md) | module-by-module flows |
| 06 | [Deployment & configuration](docs/06_DEPLOYMENT_AND_CONFIGURATION.md) | deployments, properties, triggers |
| 07 | [Security & risks](docs/07_SECURITY_AND_RISKS.md) | auth model, findings, prioritized risks |
| 08 | [Bug register](docs/08_BUG_REGISTER.md) | confirmed / suspected issues |
| 09 | [AI developer guide](docs/09_AI_DEVELOPER_GUIDE.md) | rules for AI coding agents |
| 10 | [Testing & maintenance](docs/10_TESTING_AND_MAINTENANCE.md) | tests, regression checklist, backups |
| 11 | [GitHub & branching](docs/11_GITHUB_AND_BRANCHING_STRATEGY.md) | branches, PRs, tags |
| 12 | [CI/CD & releases](docs/12_CI_CD_AND_RELEASE_PROCESS.md) | CI, CD design, rollback |
| 13 | [Environments & deployment](docs/13_ENVIRONMENTS_AND_DEPLOYMENT.md) | dev/staging/prod, clasp sync |
| 14 | [Domain & production readiness](docs/14_DOMAIN_AND_PRODUCTION_READINESS.md) | branded subdomain options, go-live checklist |

## Current limitations (summary)

- The live web app is deployed **"Execute as: me / Anyone, even anonymous"**. Several
  data-modifying maintenance functions can be called with no login ([SEC-01](docs/07_SECURITY_AND_RISKS.md)).
- An older deployment (B) is still live and runs older server code.
- There is no staging environment, no automated deployment, and no protected `main` branch yet.
- Data integrity issues have been confirmed in live data: duplicate CallLog/FollowUp IDs, a column
  order mismatch in Archive, and an incomplete approval audit trail. See [docs/08](docs/08_BUG_REGISTER.md).
