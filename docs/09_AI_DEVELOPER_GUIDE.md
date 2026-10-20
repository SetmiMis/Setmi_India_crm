# 09 — Guide for AI Coding Agents (and new developers)

Read this before you change anything. The system is live, its data is real customer data, and
**the code you edit can be called by anonymous internet users**.

## Mandatory rules

1. **Read first.** Read `README.md`, then the docs relevant to your task (03 for data, 05 for
   behaviour, 07 for security), then **the actual source in `src/`**. The docs describe the
   2026-10-20 baseline and can drift, so the source wins. If they disagree, report it and update
   the doc.
2. **Do not trust assumptions.** Verify every function, sheet and column you rely on in the
   source. Never invent sheet names, headers, functions, triggers or properties.
3. **Trace before changing a shared function.** `grep -n "fnName(" src/*` covers server *and*
   client callers. Server functions are called from HTML partials through
   `google.script.run.fnName`. Check menus (`onOpen` in `Code.js`) and triggers (`newTrigger(`) too.
4. **Understand the full flow** (UI partial → `google.script.run` → server → sheet → cache
   invalidation → UI refresh) before touching data logic. Any function that writes Enquiries,
   CallLog or FollowUps **must** call `invalidateEnqCache_()` / `invalidateCallCache_()` /
   `invalidateFuCache_()`.
5. **Preserve business rules** unless the change is explicitly approved. The rules include:

   | Rule | Detail |
   |---|---|
   | Follow-up cadence | Hot 1 / Warm 2 / Cold 6 working days, Sunday skipped |
   | Grade matrix | `gradeFor_` |
   | Terminal stages | Won/Lost/Dispatched/Closed clear Priority + NextFollowUp |
   | Won | requires InvoiceNo |
   | Intake | every manual intake goes through Pending |
   | Rep scoping | `LeadBy === Users.Name` |
   | Delete | soft delete only |
   | Phone identity | phone is the customer key, with cascade on edit |

   The unit tests in `tests/unit/business-rules.test.js` pin several of these.
6. **Never rename** a sheet, header, function or HTML file without a dependency review:
   - Headers are matched by **exact text** (`colMapFromRow_`).
   - HTML partials are referenced by name in `include()`.
   - Server functions are referenced by name from the client, menus and triggers.
   - A second application (the Next.js/Vercel port) also writes this workbook (see 01).
7. **Public by default.** Any top-level server function whose name lacks a trailing `_` is
   callable anonymously. New helpers **must** end in `_`. New endpoints **must** start with
   `requireAuth_(token)`, plus a role or ownership check where needed. Update the allow-list in
   the tests when you deliberately add a public endpoint.
8. **No unrelated refactoring.** Keep diffs minimal and match the surrounding style: ES5-ish
   `function(){}` in client code, `const`/`let` server-side, Hinglish UI messages.
9. **Protect data and secrets.** Never commit:
   - credentials or Script Property values
   - `.clasp.json` / `.clasprc.json`
   - exports
   - screenshots or fixtures with real customer names, phones, emails or GSTINs

   Use synthetic data in tests. Never print sheet contents into logs, PRs or issues.
10. **Tests.** Behaviour changes need an updated or new test (pure logic → Node unit test, file
    contracts → `contracts.test.js`) **and** the relevant regression-checklist rows from 08.
    Run `npm run ci`.
11. **Impact and rollback.** Every PR states: what changes for users, which sheets and columns
    are affected, whether existing rows need migration, and how to roll back (redeploy the
    previous version; see 12).
12. **Update the docs** in the same PR when behaviour, schema or architecture changes. That
    covers 03 for schema, 05 for behaviour, 07 for security, 08 for bug status.
13. **No production changes without explicit authorization.** That includes:
    - `clasp push` / `clasp deploy` to the production script
    - editing the live workbook
    - changing sharing, Script Properties or triggers
    - archiving deployments

    Use staging.
14. **Report uncertainty** instead of guessing. Write "[?] unknown, needs X" rather than inventing.

## Apps Script specifics

- All server files share one global scope. Top-level code runs on **every** execution (keep it
  cheap and side-effect free). `CONFIG.ADMIN_EMAIL` and `INTERNAL_BYPASS_` are evaluated per
  execution.
- `SpreadsheetApp.getUi()` throws in web-app context. Do not call it from functions the web app
  can reach.
- Quotas: 6-minute execution limit; CacheService 100 KB/value, 6 h max; PropertiesService
  9 KB/value, 500 KB total; UrlFetch and MailApp daily quotas.
- `LockService.getScriptLock()` is project-wide. Do not nest two acquisitions in one call (see
  the comment in `logCall`).
- `Session.getActiveUser()` is usually empty under "execute as me". Use the app session
  (`requireAuth_` result) for identity.

## Local workflow

```
npm run ci                  # structure, syntax, secrets, unit + contract tests
TZ=Asia/Kolkata node --test tests/unit/business-rules.test.js
```

`tests/helpers/loadGas.js` runs `src/*.js` in a Node vm with stubbed `Session`/`Utilities`.
Functions that touch Sheets, Cache or Lock are not unit-testable there and need the staging
checklist.

## Where things are

| Need | Look at |
|---|---|
| Enums, headers, sheet keys | top of `src/Code.js`, `CALL_*` in `src/CallLog.js` |
| Routing | `doGet` in `src/Code.js` |
| Auth | `requireAuth_`, `login`, `checkPin`, `requireOwnLeadOrAdmin_` in `src/Code.js` |
| Cached reads | `cachedSheetRows_`, `getAll*_` in `src/Code.js` |
| UI tab ↔ file | `src/Index.html` tabs + `include()` list; table in 04 |
