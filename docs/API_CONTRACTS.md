# API contracts

## HTTP endpoints (web/src/app/api)

| Method + path | Auth | Response |
|---|---|---|
| `GET /api/health` | none | `200 {"status":"ok","db":"ok","time":…}` or `503 {"status":"degraded","db":"error"}` |
| `GET /api/public/metrics` | `Authorization: Bearer <metrics key>` (or `?key=` legacy) | counts-only JSON (below); `401`, `429`, `503` |
| `POST /api/cron/daily-digest` | `Bearer CRON_SECRET` | `{"status":"sent"|"skipped"|"failed","detail"?}` |
| `POST /api/cron/meta-import` | `Bearer CRON_SECRET` | `{"status":"ok","imported":n,"duplicates":n}` or skipped/failed |
| `GET /api/export/enquiries?…pipeline filters` | session | CSV (UTF-8 BOM), RLS-scoped, audited |
| `GET /api/export/report?from&to` | admin session | CSV |
| `GET /api/export/won-customers` | session | CSV, RLS-scoped, audited |
| `GET /api/attachments/{enquiry|pending}/{id}` | session + RLS on the row | 302 to a 60-second signed URL |
| `GET /auth/confirm?code|token_hash&type&next` | email link | 302 |

### Public metrics body
```json
{ "as_of": "…", "customers": 0, "enquiries_total": 0, "enquiries_this_month": 0, "calls_this_month": 0,
  "follow_ups_this_month": 0, "months": [{"month":"2026-10","count":0}],
  "demand": [{"name":"Circular & GX connectors","count":0}],
  "states": [{"state":"Delhi","iso":"IN-DL","count":0}] }
```
Same fields as the legacy `?page=metrics` feed, plus `iso`. No names, phones, values, owners,
win/loss, overdue or backlog.

## Database RPCs

Signed-in (`authenticated`) functions authorize the caller themselves; errors carry `hint` ∈
`unauthenticated | forbidden | not_found | invalid | conflict | already_reviewed`.
Server-only (`service_role`): `submit_public_enquiry`, `admin_create_profile`, `admin_update_profile`,
`resolve_share_link`, `verify_metrics_key`, `rate_limit_hit`, `oms_complete_order`,
`analysis_rows_shared`, `public_metrics`, `digest_data`, `job_try_start`, `job_finish`, `audit_event`.
The full list with arguments is in `supabase/migrations/20261023000600_security.sql`.

## OMS (outbound) — reverse-engineered, NOT verified live

From legacy `src/OmsBridge.js`. Base `OMS_URL`, header `Authorization: Bearer OMS_INGEST_TOKEN`,
JSON. Timeout `OMS_TIMEOUT_MS` (default 15 s). No automatic retries (a retry could duplicate an
order); the CRM's two-phase `oms_begin_order`/`oms_complete_order` blocks duplicates on its side and
sends `Idempotency-Key: <uuid>` for an OMS that supports it.

| Call | Request | Success | Failure |
|---|---|---|---|
| `GET /api/ingest/products` | — | `{ok:true, products:[{id|_id, name|title, unit?}]}` | `{ok:false,msg}` |
| `POST /api/ingest/order` | `{enqId, customer:{company,contact,phone,whatsapp,email,gst}, items:[{productId,qty,remarks?}], note, quoteNo}` | `{ok:true, orderId}` | `{ok:false,msg}` |
| `GET /api/ingest/order/{orderId}` | — | `{ok:true, status?, piUrl?, …}` | `{ok:false,msg}` |
| `POST /api/ingest/order/{orderId}` | `{action:"piSent", by}` or `{action:"payment", amount, ref, note, proofUrl, by}` | `{ok:true}` | `{ok:false,msg}` |

Timeout handling: the request slot stays reserved for 2 minutes so a blind retry cannot create a
second order; afterwards a new attempt is allowed. Owner action: confirm the contract and whether
the OMS deduplicates by `enqId`.

## Meta Ads (inbound)

* Google Sheet (`META_SHEET_ID`) read-only with a service account (`spreadsheets.readonly`), every
  tab, header aliases from the legacy importer, `p:`/`z:` prefixes stripped.
* Or an uploaded export file (CSV/XLSX).
* Dedup key: `(source='meta', external_id)`; rows without an id get `<tab>-row-<n>` (legacy rule).
