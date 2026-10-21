# 01 — System Overview

Evidence labels used throughout these docs:
- **[V] Verified**: read in source, or seen in the live sheet or deployment on 2026-10-20.
- **[O] Observed**: seen in behaviour, not traced fully.
- **[H] Hypothesis**: a reasonable inference.
- **[?] Unknown**: needs the evidence named.

## Business context

SETMI INDIA sells industrial and electronic components: circular/aviation and waterproof
connectors, HDMI/AV, RF (SMA/UHF), metal push-button switches, and similar products [V: product
mapping in `analysisProduct_()` and `DEMAND_BUCKETS_`].

The **Sales FMS** (internal name; the workbook and script are titled **"E2O FMS"**,
Enquiry-to-Order) tracks every inbound enquiry from first contact to dispatch and feedback.

Lead sources [V `CONFIG.SOURCES`]: IndiaMART, Phone, TradeIndia, Exhibition, WhatsApp, Referral,
Walk-in, Website, Other. Meta (Facebook) Ads leads arrive through an external sheet import.

Scale on 2026-10-20 [V, live sheet]:

| Sheet | Rows |
|---|---|
| Enquiries | 4,017 (IDs up to `SETMI-ENQ-4019`) |
| Customers | 3,084 |
| FollowUps | 4,317 |
| CallLog | 2,739 |
| PendingEnquiries | 341 (109 still Pending) |
| Users | 5 (3 admin, 2 rep) |
| Team roster | 12 names (11 active) |

## Users and roles

| Role | How they get in | What they can do |
|---|---|---|
| **rep** | Username + password (`Users` sheet) | Only their own claimed leads in Pipeline, Follow-ups, Dashboard, Call stats and Analysis. They can claim unclaimed leads, propose and accept transfers, log calls, create pending enquiries and approve or reject pending enquiries (no admin check, see BUG-011) |
| **admin** | Username + password with role `admin`, **or** the shared Admin PIN (always admin) | Everything, plus Reports, Team Performance, Users, Customer/Team edits |
| **public (no login)** | `?page=enquiry` field form | Submit an enquiry into Pending Approvals. The form checks for a duplicate phone |
| **share-link viewer** | `?page=analysis&key=…` | A PII-free analysis view |
| **website** | `?page=metrics&key=…` | A counts-only JSON metrics feed |
| **spreadsheet editors** | Google Drive sharing on the workbook | Direct read/write of all data, which bypasses the app entirely (see SEC-03) |

## Modules (Deployment A, current)

The UI has 13 tabs [V `src/Index.html` lines 93–105]:

1. Dashboard
2. Follow-ups
3. Available Leads
4. Pipeline
5. Customers
6. + New Enquiry
7. Pending Approvals
8. Reports *(admin)*
9. Team Performance *(admin)*
10. Users *(admin)*
11. MAP Analytics
12. Data Analysis
13. How it Works

The app also has these surfaces outside the tabs:
- the public field Enquiry page and the analysis share page
- the metrics JSON feed
- the spreadsheet menu **"Sales FMS"**, with about 30 maintenance items
- the daily digest email
- the Meta Ads importer
- the OMS order bridge

Module-by-module detail: [05_MODULES_AND_WORKFLOWS.md](05_MODULES_AND_WORKFLOWS.md).

## Related systems

- **OMS**: a separate order management system on Vercel. The script's own comment names
  `setmi-oms.vercel.app`; the real URL is held in Script Properties (`OMS_URL`). "Record Order
  Details" creates an order there, and the CRM shows PI and payment status from it. [V `OmsBridge.js`]
- **A Next.js/Vercel port of this CRM** [H, strong]:
  - Code comments refer to a "Vercel feature backport" and "the Next.js port".
  - A Google service account (`…@ims-nextjs-…iam.gserviceaccount.com`) has **writer** access to
    the workbook.
  - PendingEnquiries rows carry `SubmittedBy = "Meta Ads auto-import"` and `ReviewedBy = "admin"`,
    values that this Apps Script code never writes.

  So a second application very likely reads and writes the same sheets. [?] Its repository,
  owner and status are unknown. This matters for any schema change.
- **Public website dashboard**: consumes `?page=metrics` [V comment in `PublicMetrics.js`]. [?] Which site.
- Two older deployments may exist. See [06](06_DEPLOYMENT_AND_CONFIGURATION.md).

## Known unknowns

| Unknown | Evidence needed |
|---|---|
| Owner, repo and status of the Next.js/Vercel port that writes to this workbook | Owner confirmation; the Vercel project |
| Whether Deployment B is the same Apps Script project (an older version) | Apps Script editor → Deploy → Manage deployments |
| Current Script Properties values (is the Admin PIN still the hardcoded default?) | Project Settings → Script properties (owner) |
| Which triggers are installed and whether they succeed | Editor → Triggers / Executions |
| User-reported bugs | Symptoms, screenshots, steps from SETMI staff (see 08) |
