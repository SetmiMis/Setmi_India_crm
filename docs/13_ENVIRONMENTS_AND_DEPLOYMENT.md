# 13 — Environments and Deployment

## Today

| Environment | Exists? | Script | Workbook | URL |
|---|---|---|---|---|
| Development | no | — | — | — |
| Staging | no | — | — | — |
| Production | yes | "E2O FMS" (bound) | "E2O FMS" | Deployment A `…PrO/exec`. Old Deployment B `…GZ1/exec` is also live |

**Source of truth today:** the Apps Script editor, not git. `src/` was exported from it on
2026-10-20 (project last modified 2026-10-07).

## Target

| Environment | Script | Workbook data | Who | Deployment |
|---|---|---|---|---|
| Dev (per developer) | Bound script in a personal copy | **Synthetic / anonymized** data only | Developer | `/dev` test URL |
| Staging | Bound script in "E2O FMS — STAGING" | Anonymized copy of production, refreshed before each release | Owner + tester | One versioned `/exec` (access: **organization or specific users**, not anonymous) |
| Production | Current "E2O FMS" | Live | Owner | Deployment A only (B archived after approval) |

How to create staging:
1. The owner runs File → Make a copy on the workbook. A copy of a container-bound sheet also
   copies its script.
2. In the copy, anonymize the data:
   - Customer, Company, Phone, Email and GST in Enquiries, Customers, Pending, CallLog and FollowUps
   - Users (set test passwords)
3. Clear the Script Properties that point at real systems: `OMS_URL`/`OMS_INGEST_TOKEN` (use the
   OMS test environment if one exists) and `META_LEADS_SHEET_ID`. Set a staging `ADMIN_PIN` or
   leave it blank.
4. Do not install triggers on staging that email real people.

Caveats:
- The external Next.js/Vercel writer (see 01) writes only to the production workbook. Staging
  will not see its rows.
- Anonymizing data must happen in the copy, never in production.

## Synchronizing git and Apps Script (clasp)

`@google/clasp` maps `src/` (rootDir) to a script project. `.js` in git corresponds to `.gs` in
Apps Script.

```
npm i -g @google/clasp
clasp login                       # writes ~/.clasprc.json (never commit)
cp .clasp.json.example .clasp.json && edit scriptId   # .clasp.json is gitignored
```

### Before the first push from git (one time, needs approval)

1. **Drift check.** Clone into a scratch directory and run `clasp pull` from production, then
   diff against `src/`. Today the only expected differences are the two redactions in
   `src/REDACTIONS.md`. Any other difference means someone edited in the editor after 2026-10-20.
   Commit that drift before anything else.
2. **Remove the redaction dependency.** Make an approved code change that reads the analysis share
   key from Script Properties and removes the default-PIN literal. Then `src/` is deployable as-is.
3. From then on, the rule is **no direct edits in the production editor**. Every change goes
   through a PR and `clasp push`. If an emergency editor edit happens, run `clasp pull` into a
   branch the same day.

### Ongoing drift detection

Before every release, run `clasp pull` into a temporary directory and check
`git diff --no-index` against `src/`. A non-empty diff blocks the release until it is
reconciled. This could become a CI job once a read-only credential is approved.

## Deployment rules

- **Never** `clasp push` to production outside the release procedure in 12. HEAD drives the menu
  and triggers immediately.
- Re-point the **existing** Deployment A (`clasp deploy -i <id>`) so the URL stays stable. Do not
  create new production deployments.
- Archive deployments that are no longer used (B) only after confirming they have no users
  (needs approval).
- Changing `appsscript.json` `webapp.access` or `executeAs` changes who can reach the app. Treat
  it as a security change with owner approval. The contract test pins the current values.
