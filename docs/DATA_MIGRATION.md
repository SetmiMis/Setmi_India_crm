# Data migration — Google Sheets "E2O FMS" → Supabase

**Status:** tooling built and tested on synthetic data (`web/tests/db/migration.test.ts`).
**No real data has been migrated.** No dry run on real exports has been performed yet.

## Principles

1. The legacy workbook is never modified. The owner exports CSVs; the tool only reads them.
2. Exports contain customer data → keep them **outside the repository**, on an encrypted drive, and
   delete them after cutover. The CLI refuses to read a folder inside the repo.
3. Dry run first. `--apply` needs `DATABASE_URL` **and** `--confirm-target <project-ref>`.
4. Every source row is accounted for: imported, imported with a documented fix, renamed, or rejected
   with a reason (`migration-issues.csv`).
5. Idempotent: inserts are keyed by legacy codes with `ON CONFLICT DO NOTHING`; a re-run adds only
   what is missing. Everything runs in one transaction and is rolled back if reconciliation fails.

## Step 1 — Export (owner)

In the workbook: for each tab, *File → Download → Comma-separated values*. Save as exactly:
`Enquiries.csv`, `Archive.csv` (if any rows), `PendingEnquiries.csv`, `Customers.csv`,
`FollowUps.csv`, `CallLog.csv`, `Team.csv`, `Users.csv` into e.g. `D:\secure\e2o-export-2026-11-01\`.
Remove any active filter on the Enquiries table first (docs/03 notes a user filter hides rows).

## Step 2 — Dry run

```bash
cd web
npx tsx scripts/migrate.ts --dir "D:\secure\e2o-export-2026-11-01"
```

Outputs in the export folder: `migration-report.md` (per-entity table), `migration-report.json`,
`migration-issues.csv` (row-level), `users_to_create.csv` (no passwords).

| Report column | Meaning |
|---|---|
| Source rows | rows in the CSV |
| Valid | rows that will be imported |
| Rejected | rows not imported (reason in issues CSV) |
| Duplicates | repeated ids (renamed or skipped, see rules) |
| Missing required | rows lacking a required field |
| Fixes applied | rows imported with a documented normalisation |

## Mapping rules

| Source | Target | Rule |
|---|---|---|
| Team.Name / Active | team_members | names found only in LeadBy/Employee/By are added **inactive** |
| Users | (none) | logins are **re-created** in the new app; legacy salted SHA-256 hashes are not portable. `users_to_create.csv` lists them |
| Customers.CustID | customers.cust_code | duplicate CustID → later skipped; second active customer with the same phone → imported inactive |
| Enquiries + Archive | enquiries | header-driven (immune to BUG-002); Archive rows get `archived_at` |
| EnqID blank | — | rejected (the 7 blank rows) |
| EnqID duplicate | — | later row skipped |
| Stage | stage | case/spacing fixed; unknown → rejected |
| Source not in list | `Other` | logged |
| Priority/NextFollowUp on closed-out stage | cleared | legacy `clearPriorityOnClosedStages` rule |
| LeadBy (name) | owner_id | via roster name |
| Phone | customer_id | by last-10-digit key; a customer is created if none exists (legacy `backfillCustomers_`) |
| Notes `MetaLeadID:x` | external_lead_refs | preserves Meta dedup |
| PhotoUrl (Drive link) | appended to notes | files stay in Drive (owner decides whether to move them) |
| TransferTo | enquiry_transfers (Proposed) | |
| Pending Status Approved but enquiry missing | re-queued as Pending | logged |
| Pending Rejected without reason | reason "(not recorded in legacy sheet)" | |
| Pending Phone `=+91…` / `#ERROR!` | cleaned / cleared | BUG-016 |
| SubmittedBy contains "Meta" | submitted_via `meta_import` | else `legacy` |
| FollowUpID / CallLogID duplicates | kept as `<id>-D1`, `-D2` | BUG-003 |
| CallNumber | renumbered 1..n per enquiry | so `(enquiry, call_number)` is unique |
| Rows pointing to a missing EnqID | rejected as orphans | |
| Code counters | set to the highest legacy number | new codes continue after them |

## Step 3 — Rehearsal (staging copy)

Apply to a **separate** Supabase project or branch first, then:

1. `reconcile()` runs automatically: every migrated code must be present (otherwise rollback).
2. Spot-check in the app: 20 random enquiries vs the sheet (stage, owner, next follow-up, calls).
3. Compare dashboard totals with the legacy dashboard for the same filters.
4. Re-run the apply: it must report 0 inserted rows.

## Step 4 — Cutover (only with written owner approval)

1. Announce a freeze window; set the legacy app to read-only by agreement (no code change needed).
2. Final export → dry run → apply to production → reconcile.
3. Create user logins from `users_to_create.csv` (Users & Team page); share passwords privately.
4. Switch staff to the new URL. Keep the legacy URL available read-only for at least 30 days.

## Rollback

* Before cutover: drop and recreate the target project/branch (no production impact).
* After cutover: staff return to the legacy URL (it was never changed); new-app records created after
  cutover are exported from the new app (CSV export) for manual re-entry. Database point-in-time
  recovery (Supabase plan dependent) restores the pre-migration state if needed.
