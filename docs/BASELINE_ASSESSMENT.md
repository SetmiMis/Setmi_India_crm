# Phase 0 — Verified Baseline Assessment (2026-10-23)

Evidence was gathered from the repository at commit `d0a6dfa` (branch `main`), the legacy source in
`src/`, the existing docs 01–14, the FMS PDF *"Enquiry to Order FMS Lead Tracking Log"*, and a
**read-only** inspection of the Supabase project. Labels: **[V]** verified in source/tool output,
**[D]** taken from existing docs and not re-verified live, **[?]** unresolved.

## 1. Repository and Git state [V]

| Item | Finding |
|---|---|
| Local folder | `C:\Users\Setmi India\Documents\Setmi_india_devlopment\Setmi_india_crm` was **empty**; the repo was cloned into it (no local work existed to preserve). |
| Branches | `main` (HEAD `d0a6dfa`), remote `docs/initial-audit`, `fix/sec-01-02-04-11` (already merged via #2). |
| Work branch | `feat/production-crm-modernization` created from `main`. |
| Baseline CI | `npm run ci`: structure ✅, syntax ✅ (35 blocks), secrets ✅, unit tests **fail to start on Windows** (`TZ=… node` is POSIX syntax). Run with bash: **27/27 pass**. Fixed: `scripts/run-tests.js` sets TZ portably. |

## 2. Architecture and framework [V]

Google Apps Script (V8) web app, container-bound to the Google Sheets workbook "E2O FMS"; 8 server
files (`Code.js` 3,199 lines), 21 HTML/JS partials, one global server scope. Deployed
*Execute as: me / Anyone, even anonymous*. See docs/02.

## 3. Modules and source files [V]

| Module | Server | Client |
|---|---|---|
| Login / session (users + shared PIN) | Code.js `login`, `checkPin`, `requireAuth_` | app.js |
| Dashboard + charts | `getDashboardData`, `computeDashboardKpis_` | dashboard.js, dashboardCharts.js |
| Follow-ups | `getFollowUpsDue`, `getFollowUpBadgeCounts` | followup.js |
| Available Leads / claim | `getUnclaimedEnquiries`, `claimEnquiry` | availableLeads.js |
| Pipeline / enquiry detail / transfer | `getPipeline`, `getEnquiry`, `editEnquiry`, `moveStage`, `proposeTransfer`… | pipeline.js, modal.js |
| Customers | `getCustomers`, `addCustomer`, `editCustomer` | customer.js |
| New Enquiry → Pending | `submitPendingEnquiry` (+PDF to Drive) | newEnquiry.js |
| Public field form | `submitFieldEnquiry`, `checkPhoneDuplicate` | Enquiry.html |
| Pending Approvals | `approvePendingEnquiry`, `rejectPendingEnquiry`, `updatePendingEnquiry` | pending.js |
| Bulk Import | `submitBulkPendingFromRows` | bulkImport.js (SheetJS) |
| Call Management | CallLog.js `logCall`, `getCallDashboard` | callLog.js |
| Reports / Team Performance | `getReports`, `getTeamPerformance`, `generateReportSheet` | reports.js, teamPerformance.js |
| Users & Team | `addUser`, `setUserRole`, `setUserActive`, `addTeamMember`… | users.js |
| MAP Analytics | MapAnalytics.js, PincodeGeo.js (19,238 pincodes) | mapAnalytics.js |
| Data Analysis + share link + Customers List | Analysis.js | analysis.js, Share.html |
| Public metrics feed | PublicMetrics.js | — |
| OMS bridge | OmsBridge.js | omsOrder.js |
| Meta Ads import | MetaLeadsImport.js | (Available Leads button) |
| Daily digest | `sendDailyDigest`, `setupDailyTrigger` | — |
| Archive / restore, data-quality menu tools | Code.js menu functions | Sheets menu |
| WhatsApp templates, Order FMS Google Form link | `waWelcome_`, `waFollow_`; modal.js `orderFormUrl_` | modal.js |

## 4. Business rules extracted from code [V]

| Rule | Source | Value |
|---|---|---|
| Stages | `STAGES` | New, Quoted, Follow-up, Won, Lost, Dispatched, Closed; open = New/Quoted/Follow-up |
| Transitions | `moveStage` | **not enforced** (BUG-009) — new app enforces the documented flow |
| Follow-up cadence | `FOLLOWUP_INTERVAL_DAYS`, `addWorkingDays_` | Hot 1 / Warm 2 / Cold 6 working days; Sunday + `EXTRA_HOLIDAYS_` skipped; unknown → Warm |
| Grade | `gradeFor_` | Qty bands <20 / 20–500 / >500 × Immediate/Fortnight/Just Exploring → A/B/C |
| Terminal stages | `moveStage` | Won/Lost/Dispatched/Closed clear Priority + NextFollowUp |
| Won | `moveStage` | InvoiceNo required unless set by OMS bridge |
| Call → stage | `writeNote_` | a logged call moves New/Quoted → Follow-up and recomputes NextFollowUp |
| Calls | CallLog.js | statuses Connected/Not Connected/Busy/Switched Off/No Answer; interest only when Connected; soft limit 6 |
| Intake | `savePendingRow_` | every manual intake goes to Pending; approval without LeadBy → unclaimed |
| Claim | `claimEnquiry` | first claimer wins (script lock) |
| Transfer | `proposeTransfer` / `acceptTransfer` | owner proposes; ownership moves on accept |
| Dashboard funnel | `computeDashboardKpis_` | Contacted / Approved (Quoted+) / Converted, as in the PDF "Command Center" |
| Customer identity | `phoneKey_` | last 10 digits; edits cascade to all enquiries with that phone |
| Archive | `ARCHIVE_MONTHS_` | closed-out stages older than 6 months |

## 5. FMS PDF vs source [V]

The PDF is a generic 12-slide framework ("Lavanika Lead Operations Framework", fabric examples).

| PDF | Code | Decision |
|---|---|---|
| 6 stages: Intake, Grading, First-Strike, Escalation, Nurture loop, Command Center | Implemented as Pending → Grade → Claim/Call → Escalation field → follow-up engine → dashboard | Code wins; mapping documented in USER_GUIDE |
| Grade matrix middle band **20–200 m** | `gradeFor_` uses **20–500** | **Code value kept** (authoritative); flag to owner |
| "Strict 7-day recall" for unclosed leads | Cold = 6 working days ≈ 7 calendar days | Kept |
| HOT/WARM/COLD "FMS score 1–9" | No score in code; priority is chosen manually | Not invented; priority stays manual |
| Stage names "Untriaged", "To Call", "Dropped" | Not used in code | Not added |
| Won generates "PI link / Order No (ORD-…)" | OMS bridge returns OMS order id + PI link | Implemented via OMS adapter |

## 6. Data [D, from docs/03 — live sheet not re-read]

Enquiries 4,017 · Customers 3,084 · FollowUps 4,317 · CallLog 2,739 · PendingEnquiries 341 · Users 5 · Team 12.
Known integrity defects: 34 duplicate CallLogIDs, 2 duplicate FollowUpIDs, Archive column order
mismatch, Pending lacks Qty/Timeline, blank ReviewedBy, 7 blank Enquiry rows, phone-as-formula rows.

## 7. Security risks [D + V]

SEC-01…SEC-15 in docs/07 (anonymous access to maintenance functions, shared admin PIN, broad sharing,
public share key, old Deployment B, PII in URLs/emails, weak audit). The new app addresses each one in
its own design — see SECURITY.md §6. **The repository is public and documents live
vulnerabilities (SEC-15) — recommend making it private.**

## 8. Supabase project (read-only inspection) [V]

Project `Setmi_india_crm` (`nhhlewvvqsfcbstukzul`), Postgres 17, region ap-northeast-1, created
2026-10-22, status healthy. **Empty**: no public tables, no migrations, 0 auth users, no storage
buckets. Extensions installed: plpgsql, pgcrypto, uuid-ossp, pg_stat_statements, supabase_vault.
No changes were made.

## 9. Constraints and open questions

| # | Question / blocker | Owner action |
|---|---|---|
| Q1 | Apply the migrations to the Supabase project? (empty, but a live project) | Approve |
| Q2 | Hostinger plan (Business/Cloud needed for Node apps) and the subdomain | Confirm |
| Q3 | Meta leads: Pending (new default) or straight to Available Leads (legacy)? | Decide (setting) |
| Q4 | Grade band 20–200 (PDF) vs 20–500 (code)? | Confirm |
| Q5 | Should reps keep approving pending leads (legacy) — new app: admins only | Confirm |
| Q6 | OMS URL/token and contract confirmation; Order FMS Google Form still used? | Provide / confirm |
| Q7 | The external Next.js/Vercel port that writes the same workbook — retire before cutover? | Confirm |
| Q8 | Sheet exports for the migration dry run (CSV per tab) | Provide (outside the repo) |
