# 10 — Testing and Maintenance

## Automated tests (exist and run in CI)

| Suite | What it proves | What it does not prove |
|---|---|---|
| `npm run check:structure` | Required source and doc files exist; manifest is valid JSON; no `.clasp.json` committed | Anything about behaviour |
| `npm run check:syntax` | Every `src/*.js` and every inline `<script>` in `src/*.html` parses (scriptlets replaced with a placeholder) | Runtime errors, undefined references |
| `npm run check:secrets` | Known secret shapes (redacted literals reintroduced, private keys, tokens, service-account JSON) are absent from tracked files | Arbitrary secrets (gitleaks in CI covers more) |
| `tests/unit/business-rules.test.js` (12 tests) | Pure business rules: stages, grade matrix, phone key, state normalization, follow-up cadence, follow-up status, ID generation (incl. BUG-005 pinned), parsing, product mapping, password hashing, row mapping | Anything touching Sheets/Cache/Lock/Drive |
| `tests/unit/security.test.js` (9 tests) | SEC-01 guard (anonymous, non-owner, menu and owner cases; guarded setters refuse before writing; digest trigger check), SEC-02 PIN policy and no seeded default, SEC-04 share key from properties, SEC-11 `badge()` escaping | Real `getUi()` / `getActiveUser()` behaviour in Apps Script (staging check R22) |
| `tests/unit/contracts.test.js` (6 tests) | Every `google.script.run.fn` the client calls exists as a public server function; **every public server function authenticates, is guarded, or is in the reviewed anonymous list (SEC-01)**; `include()` targets exist; `doGet` templates exist; menu items/trigger handlers exist; manifest settings are the documented ones | Correct arguments/return shapes |

Results on 2026-10-20 (local, Node 22): **17/17 tests pass**. After the SEC-01/02/04/11 change
(2026-10-21): **27/27**. 35 files/blocks were syntax-checked
with 0 failures. The secret scan is clean.

The gitleaks job and the CI run on GitHub **have not run yet**, because nothing has been pushed.

## Manual tests

The regression checklist R1–R21 lives in [08_BUG_REGISTER.md](08_BUG_REGISTER.md#regression-checklist-baseline-run-before-and-after-any-approved-change).
Run it on **staging** for every release. Record the release tag, the tester, the date, and
pass/fail per row in the PR or release notes.

## Suggested next test investments (after approval)

1. **SEC-01 guard test:** an explicit allow-list of anonymous-callable functions. Fail when a new
   un-underscored function lacks `requireAuth_`.
2. A thin in-memory `SpreadsheetApp`/`LockService`/`CacheService` fake so that `addEnquiry`,
   `claimEnquiry`, `moveStage` and `writeNote_` can be unit tested against synthetic sheets.
3. A staging smoke script run with `clasp run` (needs the API-executable deployment on staging):
   create a lead, approve, claim, log a call, move to Won, clean up.

## Backup and recovery

| What | How (owner) | Frequency |
|---|---|---|
| Workbook | Sheets *Version history* exists automatically. Also schedule *File → Make a copy* (or a Drive export to xlsx) into an owner-only folder | Before every release + weekly |
| Script | Apps Script keeps numbered versions per deployment. Git (`src/`) once the repo is in sync | Every release |
| Script Properties | Record the names (values in a password manager). There is no export API in the UI | On change |
| Drive PDFs folder | Covered by Drive. Note that the files are link-shared | — |

**Restore:**
- Data: use Version history to restore the workbook, or copy affected ranges from a backup copy.
- Code: Manage deployments → Edit → select the previous version (see 12, Rollback).

## Routine maintenance

- **Monthly:**
  - Run the read-only "Run Audit" menu item and record the counts (duplicate IDs, invalid
    stage/priority, unknown LeadBy, blank State/Pincode).
  - Review Users (deactivate leavers) and the sharing list.
- **Quarterly:** rotate `ADMIN_PIN` (or remove it), the analysis share key and
  `PUBLIC_METRICS_KEY`; check the Script Properties size (geocode caches).
- Watch the ID sequences against 9999 (BUG-005).
- Do **not** use Archive/Restore until BUG-002 is fixed.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| "Session expired — please reload…" right after login | CacheService propagation (3 retries exist) or the 6 h expiry | Reload; check Executions for errors |
| Rep sees nothing / wrong leads | `Users.Name` ≠ `Enquiries.LeadBy` text | Compare exact strings (spaces, case) |
| `#ERROR!` in Phone, or "X.trim is not a function" on approve | Phone parsed as a number/formula | Menu → Fix Phone Formatting (on staging first) |
| New data not visible for up to 90 s after a direct sheet edit | Row cache TTL | Expected. Any app write invalidates it |
| Map points stacked on state centres | Missing pincode/district geocode | Menu → Warm Map District Geocoding |
| Meta leads not arriving | Trigger not installed or not firing (BUG-008), sheet ID property unset | Editor → Triggers / Executions |
| "Won karne ke liye Invoice Number…" | Won needs InvoiceNo | By design |
