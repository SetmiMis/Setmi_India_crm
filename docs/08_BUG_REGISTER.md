# 08 — Bug Register and QA Baseline

**Baseline date:** 2026-10-20.

**Nothing has been fixed.** Each entry needs approval before any change is made.

**Status values:**

| Status | Meaning |
|---|---|
| **Confirmed-live** | Seen in live data or deployments |
| **Confirmed-code** | Unambiguous code path; not reproduced on production, because reproducing would change data |
| **Suspected** | Plausible; needs the investigation listed |
| **Needs decision** | Possibly intended behaviour |

> **User-reported bugs: none received yet.** The bugs that prompted this audit have not been
> described. Please send the symptom, who saw it, when, which deployment URL, the steps, and a
> screenshot. Use the template at the end.

## Summary

| ID | Module | Severity | Status | Title |
|---|---|---|---|---|
| BUG-001 | Security / all | Critical | Confirmed-code | Anonymous callers can run data-modifying maintenance functions (= SEC-01) |
| BUG-002 | Archive | High | Confirmed-live (latent) | Archive column order and width differ from Enquiries; archive/restore copy by position |
| BUG-003 | Call Log / Follow-ups | High | Confirmed-live | 34 duplicate CallLogIDs, 2 duplicate FollowUpIDs |
| BUG-004 | Enquiry edit / stage | High | Confirmed-code | Lost-update race: unlocked full-row rewrites |
| BUG-005 | All ID generation | Medium (latent) | Confirmed-code + unit test | IDs wrap to `…-0000` after 9999 |
| BUG-006 | Intake → Pending | Medium | Confirmed-live | Pending sheet lacks Qty/Timeline, so intake values are dropped and Grade is never set |
| BUG-007 | Meta import | Medium | Confirmed-code | Dedup ignores Archive; imported leads skip Customers; two importers behave differently |
| BUG-008 | Meta import trigger | Medium | Suspected | 30-min trigger targets the private function `importNewMetaLeads_` |
| BUG-009 | Stage move | Medium | Confirmed-code | `moveStage` accepts any stage value and any transition |
| BUG-010 | Transfer | Low | Needs decision | `editEnquiry` lets an owner reassign LeadBy directly, bypassing acceptance |
| BUG-011 | Pending Approvals | Low | Needs decision | Any rep can approve/reject (no admin check) |
| BUG-012 | Enquiries data | Low | Confirmed-live | 7 blank rows inside the Enquiries table |
| BUG-013 | Deployments | High | Confirmed-live | Deployment B serves an older build against live data (= SEC-05) |
| BUG-014 | Charts | Low | Confirmed-code | ApexCharts loaded unversioned; a new release can break the dashboard |
| BUG-015 | Workbook | Info | Confirmed-live | `Orders` / `OrderItems` tabs orphaned (no code uses them) |
| BUG-016 | Pending data | Low | Confirmed-live | Phone stored as a formula (`+91…`) in Pending rows written by the external importer |
| BUG-017 | Auth / audit | Medium | Confirmed-live | `Session.getActiveUser()` is blank under "execute as me", so ReviewedBy/SubmittedBy are mostly empty and "Forgot password" mail is likely never sent |
| BUG-018 | Dashboard / Reports | Medium | Confirmed-code | Nothing writes QuoteAmount/OrderValue, so "Won revenue" stays 0 and pipeline value falls back to EstValue |
| BUG-019 | Call Log | Medium | Confirmed-code | `logCall` has no ownership check; `employee` is client-supplied (= SEC-06) |
| BUG-020 | Reads | Medium | Confirmed-code | `getEnquiry` and Customers have no rep scoping (= SEC-06) |
| BUG-021 | Logout | Low | Confirmed-code | Logout doesn't revoke the server token (= SEC-09) |

## Details

### BUG-002 — Archive layout mismatch

- **Evidence:** Enquiries headers (40 columns) put `ClaimedAt` and `TransferTo` at AG–AH and
  `ShipmentWeight` at AI. Archive headers (38 columns, created from `ENQ_HEADERS`) have no
  ClaimedAt/TransferTo and put ShipmentWeight at position 28. `archiveOldClosedLeadsFromMenu`
  writes ENQ rows positionally with width 40 into a 38-column sheet.
- **Expected:** the archived row keeps its column meaning.
- **Actual (predicted):** the write fails with an out-of-bounds range error, or, if the grid were
  wider, the values would shift under the wrong headers. Restore copies positionally back.
- **Impact:** data corruption the first time someone archives. Archive is currently **empty**, so
  nothing is corrupted yet.
- **Next step:** do not use Archive/Restore until fixed. The fix maps rows by header name.
- **Regression:** archive then restore a test row on staging, and compare all 40 fields.

### BUG-003 — duplicate activity IDs

- **Evidence:**
  - CallLog has 2,739 rows, max `CALL-2701`, and 34 IDs used twice (for example `CALL-1438`).
  - FollowUps has 2 duplicates (`FU-0408`, `FU-0511`).
- **Root cause (CallLog, confirmed in code):** `logCall` reads CallLog **before** taking the lock
  and before `writeNote_`, then computes the ID from that stale snapshot inside the lock. Two
  concurrent calls get the same ID. `CallNumber` is also computed from the stale count.
- **FollowUps:** `writeNote_` computes its ID inside the lock, so the duplicates likely come from
  an earlier version or the external writer [H].
- **Impact:** IDs are not unique keys. Anything keyed on CallLogID (future edits/deletes) would
  hit the wrong row. Call numbers may repeat.
- **Next step:** list the duplicate pairs (read-only), check whether CallNumber also repeats for
  the same EnqID, then fix by re-reading inside the lock.
- **Regression:** concurrent `logCall` ×2 on staging.

### BUG-004 — lost updates

- `editEnquiry`, `moveStage`, `deleteEnquiry`, `editCustomer`, and approve/reject/update pending
  read the sheet, then write the **whole row** back, without a lock.
- A concurrent `writeNote_`/`logCall` on the same enquiry (which is locked) can be overwritten by
  the older snapshot. For example, a rep logs a call while an admin edits the enquiry: the
  LastContact/NextFollowUp/Stage change is lost.
- **Next step:** reproduce on staging with two sessions. Fix with a lock and a re-read, or write
  only the changed cells.

### BUG-005 — ID wrap after 9999

`('000'+(max+1)).slice(-4)` turns 10000 into `0000`, and every later ID repeats `…-0000`. The unit
test `KNOWN ISSUE BUG-005` pins this behaviour.

Distance to failure:

| Sequence | Current max | IDs left |
|---|---|---|
| FU | 4314 | ~5,700 |
| ENQ | 4019 | ~6,000 |
| CALL | 2701 | ~7,300 |

At current rates this is months away [H]. Fix: pad without truncating.

### BUG-006 — Qty/Timeline lost at intake

- `PEND_HEADERS` includes Qty and Timeline, but the live PendingEnquiries sheet has 24 columns
  without them.
- `savePendingRow_` and `approvePendingEnquiry` skip absent columns.
- Running `setupSheets` would add them, but it is also an SEC-01 function. [?] Check whether the
  New Enquiry form sends qty/timeline (it is in the server contract).
- **Impact:** Grade is blank for every approved lead.

### BUG-007 — Meta import gaps

- `alreadyImportedMetaLeadIds_` scans PEND and ENQ only. After a Meta lead is archived, the next
  import re-creates it.
- `bulkInsertEnquiries_` does not upsert Customers.
- The external importer sends Meta leads to Pending, while this one inserts straight into
  Enquiries. **Decision needed:** which path is canonical.

### BUG-008 — Meta trigger may never fire

`ScriptApp.newTrigger('importNewMetaLeads_')` targets a function with a trailing underscore.
[?] Verify in Editor → Triggers / Executions that it fires and succeeds. If it does not, every
"auto-import" depends on manual clicks.

### BUG-009 — unvalidated stage

`moveStage({stage})` writes whatever string it receives. Combined with `badge()` it is also an
injection vector (SEC-11). The live data currently holds only valid stages (plus 7 blanks from
BUG-012).

### BUG-017 — `getActiveUser()` under execute-as-owner

- Live data: about 170 of 232 reviewed Pending rows have a blank `ReviewedBy`.
- `CONFIG.ADMIN_EMAIL` is resolved per execution from `getActiveUser()`, so it is blank for
  non-owner callers. `requestPasswordReset` therefore likely never emails anyone.
- **Next step:** owner reviews the MailApp quota/sent items. The fix is an explicit admin email
  in Script Properties.

### BUG-018 — revenue fields never written

Grep of the source: `QuoteAmount` and `OrderValue` are only **read**. Ask sales whether they
expect to type them in the sheet, or whether the OMS should write them back.

## Regression checklist (baseline: run before and after any approved change)

Use a staging copy, never production (see 10/13). ✓ means it matches the current behaviour
described in 05.

| # | Area | Check |
|---|---|---|
| R1 | Login | user login; wrong password rejected; PIN login (while it exists); reload keeps the session; logout |
| R2 | Rep scoping | a rep sees only their own leads in Pipeline, Follow-ups, Dashboard, Call stats, Analysis; an admin sees all |
| R3 | New Enquiry | required name/phone; invalid email/GST/pincode blocked; pincode autofill; duplicate warning; PDF ≤10 MB → Pending with link |
| R4 | Field form | `?page=enquiry` submit → Pending; no login required |
| R5 | Bulk import | CSV and XLSX map → N Pending rows |
| R6 | Approve | with LeadBy → assigned; without → Available Leads; Customers upserted; Pending status Approved + ApprovedEnqID |
| R7 | Reject / edit pending | status Rejected + reason; edit only while Pending |
| R8 | Claim | claim sets LeadBy/Priority/NextFollowUp/ClaimedAt; second claim fails "Already claimed" |
| R9 | Log call | CallLog row, Call N; FollowUps row; LastContact; NextFollowUp per cadence (Hot 1/Warm 2/Cold 6 working days); New/Quoted → Follow-up |
| R10 | Stage moves | Quoted (QuoteNo/Date); Won requires InvoiceNo; Lost reason; Dispatched date/info/weight; Closed feedback; terminal stages clear Priority + NextFollowUp |
| R11 | Edit enquiry | owner/admin only; priority change recomputes NextFollowUp (open stages only); customer overwrite cascades by phone |
| R12 | Transfer | propose → target sees it → accept changes owner / decline keeps it |
| R13 | Delete | soft delete Active=NO; disappears from every list |
| R14 | Customers | list counts; edit cascades to enquiries |
| R15 | Dashboard/Reports/Team perf | numbers match a manual count on a small data set |
| R16 | Map / Analysis / share link | loads; share link hides rep/speed; invalid key → "This link is not valid." |
| R17 | Metrics | `?page=metrics` valid key → JSON counts; invalid → `{"error":"invalid key"}` |
| R18 | OMS | products load; record order → OMSOrderID + Won; PI sent; payment |
| R19 | Meta import | new rows imported once; re-run imports 0 |
| R20 | Digest | `sendDailyDigest` email content (staging recipient) |
| R21 | Users admin | add/deactivate/reset/role; self-demote blocked |

## Bug report template

```
Title:
Reported by / date:
Deployment URL used (A ...PrO/exec or B ...GZ1/exec):
User role (rep/admin/public):
Steps to reproduce:
Expected:
Actual (exact message / screenshot):
Enquiry ID(s) involved (no customer names please):
Frequency (always / sometimes / once):
```
