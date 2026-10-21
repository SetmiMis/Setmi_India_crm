# 07 — Security Review and Risk Register

**Review date:** 2026-10-20.

**Method:** static review of the full source, plus the list of exposed functions extracted from
both live deployments, plus Drive permission metadata, plus header and ID inspection of the sheet.

**Nothing was exploited or tested against production.** No unauthenticated function was invoked
and no PIN or password was tried. "Confirmed (code)" means the code path is unambiguous. "Confirmed
(live)" means it was observed in live metadata or data.

> **Handling note.** This document describes open vulnerabilities in a live system. The GitHub
> repository `SetmiMis/Setmi_India_crm` is currently **public**. Do not publish this file or
> `src/` there until the repo is private, or until SEC-01, SEC-02 and SEC-05 are fixed.

## Authentication and authorization model [V]

- The web app runs **as the owner** (`USER_DEPLOYING`) for **anyone, including anonymous users**
  (`ANYONE_ANONYMOUS`). Google does not authenticate callers. Every capability the owner's
  account has (all its Sheets and Drive files, Gmail sending, triggers) is reachable through any
  function the app exposes.
- The app's own gate is `requireAuth_(token)`. The token is a random UUID mapped in CacheService
  to `{u,name,role}` for 6 h (sliding). It is issued by `login` (Users sheet, salted SHA-256) or by
  `checkPin` (shared PIN, **always role admin**).
- Authorization:
  - Role checks (`admin`) on users, team, reports and team performance.
  - Ownership checks (`requireOwnLeadOrAdmin_`) on edit, stage, delete and OMS actions.
  - Read scoping by `LeadBy === me.name` on pipeline, follow-ups, dashboard, call dashboard and
    analysis.
- **An obscure URL is not access control.** Both `/exec` URLs answer anyone.

## Findings (prioritized)

| ID | Severity | Status | Finding |
|---|---|---|---|
| <a id="sec-01"></a>SEC-01 | **Critical** | Confirmed (code + live API list) | **Data-modifying functions are callable with no login** (detail below) |
| SEC-02 | **High** | Confirmed (code); PIN value unknown | Shared Admin PIN is a permanent admin backdoor alongside user accounts |
| SEC-03 | **High** | Confirmed (live metadata); effective public exposure unconfirmed | Workbook and script sharing is broad |
| SEC-04 | Medium | Confirmed (code) | Analysis share key hardcoded in source |
| SEC-05 | **High** | Confirmed (live) | Old Deployment B still live, anonymous, PIN-only, older server code |
| SEC-06 | Medium | Confirmed (code) | Authorization gaps for signed-in users |
| SEC-07 | Medium | Confirmed (code) | Public endpoints leak data and accept unlimited submissions |
| SEC-08 | Medium | Confirmed (code) | Customer PDFs are shared "anyone with the link" |
| SEC-09 | Low–Med | Confirmed (code) | Weak credential handling |
| SEC-10 | Low | Confirmed (code) | `XFrameOptionsMode.ALLOWALL` on every page |
| SEC-11 | Low | Suspected | Stored HTML injection through unvalidated `Stage` |
| SEC-12 | Low | Confirmed (code) | Third-party scripts |
| SEC-13 | Info | Confirmed (code) | PII leaves the system in URLs and email |
| SEC-14 | Medium | Confirmed (live data) | Weak audit trail |
| SEC-15 | **High (process)** | Confirmed (live) | The official GitHub repo is public |

### SEC-01 — anonymous access to state-changing functions (Critical)

Apps Script exposes every top-level function whose name lacks a trailing `_` to
`google.script.run`. Anyone can load the `/exec` page and call these from the browser console.
In Deployment A, the following run **without any token** and modify data, configuration or
triggers, or send mail:

| Function | Effect if called anonymously |
|---|---|
| `recalculateAllNextFollowUps()` | Overwrites NextFollowUp on **every open enquiry** (manual dates lost) |
| `setupSheets()` | Adds headers, backfills Customers, reformats columns, seeds `ADMIN_PIN` if missing, may delete "Sheet1" |
| `fixPhoneFormatting()`, `clearPriorityOnClosedStages()` | Bulk rewrites |
| `fixCityStateMixupFromMenu()` | Bulk State/City/District rewrite, which runs **before** its `getUi()` call fails |
| `importMetaLeadsFromMenu()` | Runs the Meta import (writes Enquiries) before `getUi()` fails |
| `setupDailyTrigger()`, `setupMetaLeadsImportTrigger()`, `stopMetaLeadsImportTrigger()` | Create or delete triggers (`stop…` silently disables lead import) |
| `sendDailyDigest()` | Emails the full overdue/today list (names, phones) to the admin. Can be repeated (quota / spam) |
| `requestPasswordReset(u)` | Sends mail (when ADMIN_EMAIL resolves) |
| **`setPublicMetricsKey(key)`** | **Replaces the metrics secret.** This breaks the website feed and hands the feed to the caller |
| `submitFieldEnquiry(p)` | Intended to be public (SEC-07) |

Read-only and public by design: `getConfigMeta` (team names, enums, whether a PIN is set),
`getTeam`, `getEnquiryLink`, `checkPhoneDuplicate`, `calculateFollowupStatus`, `include`.

The `*FromMenu` tools that call `getUi()` first fail harmlessly in web context.

**Fix direction** (needs approval):
1. Rename every menu-only and maintenance function with a trailing `_` (and point the menu at
   thin wrappers that check `Session.getEffectiveUser()`, or keep the menu items on `_` names,
   which menus support).
2. Add `requireAuth_` plus an admin check to the remaining ones.
3. Add a contract test listing the allowed anonymous functions.

### SEC-02 — shared Admin PIN (High)

- `checkPin(pin)` grants **admin** whenever `ADMIN_PIN` is set, even though user accounts now exist.
- The PIN is short (format suggests 4 digits). Failed attempts sleep 800 ms, but there is no
  lockout and executions run concurrently, so a full search is feasible.
- `migrateAdminPinToProperties_()` seeds a **hardcoded default**. Anyone who can view the script
  source (SEC-03) knows it.
- [?] Whether the live PIN was ever changed is unknown. The owner should check Script Properties.

**Fix:** remove the PIN path, or blank `ADMIN_PIN` (the users path then works alone). Rotate it
in any case.

### SEC-03 — broad sharing of the workbook and script (High)

The Drive API reports identical permissions on both:
- `anyone` → **reader**
- writers: the owner, two `@setmiindia.org` accounts, one external-domain account, one personal
  Gmail account, and a Google **service account** (`…@ims-nextjs-…`)
- readers: one external-domain account and one personal Gmail account

Implications:
- **Anyone who can open the workbook** can read every customer's name, phone, email and GSTIN,
  **and the Users sheet with password hashes**.
- **Any editor** can add an `admin` row to Users (the hash format is documented in source),
  change data without an audit trail, or read the script source.

An unauthenticated CSV export request returned **401**, so the "anyone" grant may be restricted
by Workspace policy. **Effective public exposure is unconfirmed.** The owner should check
Share → General access.

**Fix:**
- Restrict general access.
- Remove personal and external accounts that do not need access.
- Move the Users sheet's hashes out of a broadly shared workbook (for example a separate,
  owner-only spreadsheet, or Script Properties).

### SEC-04 — hardcoded analysis share key (Medium)

`ANALYSIS_SHARE_KEY_` is a literal in `Analysis.js`. Anyone with script view access has it.
Rotating it requires a redeploy. It is redacted in git (`src/REDACTIONS.md`).

**Fix:** move it to Script Properties and rotate it.

### SEC-05 — stale Deployment B (High)

- Deployment B serves an older build with 44 functions and PIN-only login, which is still
  anonymous. Its server code is older than the current source and **cannot be audited from
  here**.
- The current code's comments describe security fixes made since (field form bypassing Pending,
  `addUser` privilege escalation, rep scoping on the dashboard). **B may still contain those
  holes.**

**Fix:** confirm nobody uses it, then archive it in Deploy → Manage deployments (needs approval).

### SEC-06 — authorization gaps for signed-in users (Medium)

- `getEnquiry(id)`, `getCallHistory`, `getCustomers`, `getCustomerByPhone`: there is **no
  ownership scoping**. A rep can read any enquiry by ID (IDs are sequential) and the whole
  customer list.
- `logCall`: no ownership check. `employee` is supplied by the client, so call attribution can
  be spoofed. A call also updates the lead's LastContact, NextFollowUp and Stage.
- `approvePendingEnquiry`, `rejectPendingEnquiry`, `updatePendingEnquiry`: there is no admin check.
- `generateReportSheet`: any user (it deletes and recreates a sheet).
- `editEnquiry` accepts `leadBy`, so an owner can reassign without the transfer acceptance step.
- `importMetaLeadsNow`: any user.

### SEC-07 — public endpoints (Medium)

- `submitFieldEnquiry`: no CAPTCHA, rate limit or size limit. Spam can flood PendingEnquiries.
  The submitter can preset `leadBy` and `priority`.
- `checkPhoneDuplicate(phone)`: tells an anonymous caller whether a phone is a SETMI customer,
  plus its enquiry count, last date and **last stage**.
- `getConfigMeta` / `getTeam`: staff roster names.

### SEC-08 — customer documents public by link (Medium)

`submitPendingEnquiry` sets every uploaded PDF to `ANYONE_WITH_LINK / VIEW`, and the link is
stored in the sheet (which is itself broadly shared).

### SEC-09 — credential handling (Low–Medium)

- Passwords are hashed with a single salted SHA-256 iteration. The minimum length is 6. There is
  no lockout, only a 600 ms delay.
- The session token is stored in `localStorage`. **Logout does not revoke the token
  server-side**: `logout()` only clears the browser, so a copied token stays valid for 6 h.

### SEC-10 / SEC-11 / SEC-12 / SEC-13 (Low / Info)

- **SEC-10:** `ALLOWALL` permits clickjacking-style framing.
- **SEC-11:** `moveStage` stores any `stage` string, and `badge(st)` writes it into `innerHTML`
  unescaped. Only authenticated users can set it. The impact is limited by the
  googleusercontent sandbox, but it could steal the `localStorage` token. Note also `pri-'+Priority`
  in a class attribute.
- **SEC-12:** `apexcharts` is loaded **unversioned** from jsDelivr (supply-chain and breakage
  risk). `xlsx@0.18.5` has known advisories (CVE-2023-30533, CVE-2024-22363) and parses
  user-supplied files.
- **SEC-13:** the "Order FMS" Google Form prefill and `wa.me` links put customer PII in URLs
  (browser history, form owner). The daily digest emails names and phones.

### SEC-14 — audit trail (Medium)

- `ReviewedBy` / `SubmittedBy` use `Session.getActiveUser()`, which is blank for most callers
  under "execute as me". About 170 of 232 reviewed Pending rows have no reviewer recorded.
- There is no change history for edits, stage moves or deletes beyond the Notes text.
- `FollowUps.By` and `CallLog.Employee` are client-supplied.

### SEC-15 — public GitHub repository (High, process)

`SetmiMis/Setmi_India_crm` has **public** visibility. Committing `src/` (even redacted) or these
docs would publish a working map of SEC-01 and SEC-02 while they are still open.

**Recommendation:** make the repo private **before** the first push.

## Logging of personal data

- `exceptionLogging: STACKDRIVER`. Errors go to Cloud Logging.
- No `Logger.log` / `console.log` of customer data was found server-side.
- The client logs errors to the browser console only.

## Secrets management

| Secret | Where now | Target |
|---|---|---|
| `ADMIN_PIN` | Script Properties (seeded from a source default) | Remove or rotate; remove the default from source |
| `ANALYSIS_SHARE_KEY_` | **Source literal** | Script Properties; rotate |
| `PUBLIC_METRICS_KEY` | Script Properties (can be overwritten anonymously) | Admin-only setter |
| `OMS_INGEST_TOKEN` | Script Properties | OK. Rotate if any editor's access is removed |
| Password hashes | Users sheet (broadly shared) | Restricted storage |
| Future CI/CD credentials (clasp) | none yet | GitHub Environment secret, least privilege (see 12) |

## What is in reasonable shape [V]

- A server-side token gate exists on all business-data endpoints.
- Ownership checks exist on mutations. Rep scoping exists on lists.
- Escaping (`esc()`) is used for most user-entered text in templates.
- Formula-injection hardening exists (text-locked columns).
- Uploads are limited to PDF and 10 MB.
- Username enumeration is avoided on password reset.
- Caches are invalidated by version key rather than serving stale data indefinitely.
