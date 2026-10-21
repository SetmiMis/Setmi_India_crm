# 06 — Deployment and Configuration (current state)

## Resources [V 2026-10-20]

| Resource | Identifier | Notes |
|---|---|---|
| Apps Script project | "E2O FMS", `1QXS_eKH…cX6oN` | Container-bound to the workbook. Created 2026-06-14, last modified 2026-10-07 05:49 UTC. Owner: SETMI INDIA owner account |
| Spreadsheet | "E2O FMS", `1AjeB8fV…NVo` | Same owner and the same sharing list as the script |
| Deployment A | `…/macros/s/AKfycbzb3cZ…PrO/exec` | HTTP 200, title "SETMI INDIA — Sales FMS". **Exposes 94 functions, which match current source exactly**, and serves the 13-tab UI with per-user login |
| Deployment B | `…/macros/s/AKfycby6Vg6…GZ1/exec` | HTTP 200, same title. **Exposes 44 functions.** An older UI with 8 tabs (Dashboard, Follow-ups, Pipeline, Customers, New Enquiry, Pending Approvals, Reports, MAP Analytics), **PIN-only auth** (no `login`), and it still has `getMapAnalytics` / `getMapDrilldown`. [H, strong] An older versioned deployment of the same project, which would run **older server code against the same live sheet**. [?] Confirm in Deploy → Manage deployments |
| Drive folder | "SETMI INDIA - Enquiry Documents" (next to the workbook) | PDFs from New Enquiry, each shared anyone-with-link |

The application version is not labelled in code. The header comment says "(v2)". The Apps Script
deployment version numbers were not visible without the editor's Manage deployments screen.

## Manifest (`src/appsscript.json`)

```json
{ "timeZone": "Asia/Kolkata", "runtimeVersion": "V8", "exceptionLogging": "STACKDRIVER",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "executionApi": { "access": "MYSELF" }, "dependencies": {} }
```

- No advanced services and no libraries.
- `executionApi: MYSELF` allows `clasp run` and the Apps Script API by the owner only.
- OAuth scopes are inferred automatically. From the code they include:
  - Spreadsheets
  - Drive (create folder/file, set sharing, open external sheet by ID)
  - external requests (UrlFetch)
  - send mail
  - script triggers
  - container UI

## Script Properties (names only; values were not inspected)

| Property | Used by | Set via |
|---|---|---|
| `ADMIN_PIN` | `checkPin`, `requireAuth_`, `getConfigMeta` | `setupSheets` seeds a **hardcoded default** if missing; menu "Change Admin PIN". Blank disables the PIN gate |
| `PUBLIC_METRICS_KEY` | `?page=metrics` | `setPublicMetricsKey(key)`, **callable anonymously** (SEC-01) |
| `META_LEADS_SHEET_ID` | Meta import | menu "Set Meta Ads Leads Sheet" |
| `OMS_URL`, `OMS_INGEST_TOKEN` | OMS bridge | Project Settings → Script properties (by hand) |
| `cityStateCache_v1`, `districtGeoCache_v1` | geocoding caches (JSON) | automatic. Script Properties have a 9 KB-per-value / 500 KB-total quota, so these caches can hit it [H] |

**After the SEC-01/02/04 change (not yet deployed):**

| Property | Used by | Set via |
|---|---|---|
| `ANALYSIS_SHARE_KEY` | `?page=analysis&key=` share link (replaces the source literal `ANALYSIS_SHARE_KEY_`) | menu → Set Analysis Share Link Key. **Must be set before deploying**, or existing share links stop working |
| `ALLOW_PIN_LOGIN` | `checkPin` | Project Settings, by hand. `YES` keeps the shared PIN working after users exist; anything else disables it |

`ADMIN_PIN` is no longer seeded by `setupSheets`. Menu tools, setters and trigger setup functions
now run only from the spreadsheet menu or as the owner.

## Triggers (from code; installed state not verified)

| Handler | Schedule | Created by |
|---|---|---|
| `sendDailyDigest` | daily around 09:00 Asia/Kolkata | `setupDailyTrigger()` (menu, or **anonymously via web**: SEC-01) |
| `importNewMetaLeads_` | every 30 min | `setupMetaLeadsImportTrigger()`. The handler name ends in `_`. Verify it fires (BUG-008) |
| `onOpen` | simple trigger | builds the "Sales FMS" menu |

[?] The installed triggers and their recent execution status are visible only in the editor:
Triggers and Executions.

## Caches and sessions

| Item | Value |
|---|---|
| Session tokens | CacheService script cache `fms_auth_<uuid>`, 6 h sliding |
| Row caches | prefixes `enq`/`call`/`fu`, TTL 90 s, chunks of 80/150 rows. Version keys `*_cache_ver` |
| OMS product list | `oms_products`, 10 min |

## External endpoints

| Endpoint | Direction | Auth |
|---|---|---|
| `OMS_URL` `/api/ingest/products`, `/api/ingest/order`, `/api/ingest/order/{id}` | out | Bearer `OMS_INGEST_TOKEN` |
| `api.postalpincode.in/pincode/{pin}` | out (server: Meta import; browser: forms) | none |
| `nominatim.openstreetmap.org/search` | out (server) | none; UA `SetmiIndiaSalesFMS/1.0`, 1 req/s |
| Order FMS Google Form `docs.google.com/forms/d/e/1FAIpQLSc…/viewform` | browser link with PII in the query string | none |
| `wa.me/<phone>?text=` | browser links | none |
| External Meta leads spreadsheet | in (read-only) | owner's Drive access |

## How a change reaches production today [O/H]

There is no source control. The developer edits in the Apps Script editor (or uses `clasp`; a
code comment mentions `clasp run`). The developer then uses Deploy → Manage deployments to point
Deployment A at a new version, or creates a new deployment. There is no test environment, review
step or changelog. Deployment B appears never to have been archived.
