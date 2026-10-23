# New CRM — Security

Scope: `web/` and `supabase/`. The legacy app's findings remain in `07_SECURITY_AND_RISKS.md`.

## 1. Trust boundaries

| Boundary | Who | Entry points | Controls |
|---|---|---|---|
| Staff app | signed-in users | pages, Server Actions | Supabase session (JWT verified with `getClaims`), active profile, RLS, authorizing RPCs |
| Data API | anyone with the publishable key | Supabase REST/RPC | `anon`: no grants. `authenticated`: SELECT under RLS + allow-listed RPCs that authorize themselves |
| Public enquiry form | anonymous | `/enquiry` Server Action | allow-listed fields, zod, honeypot, idempotency key, 5/10 min + 25/day per IP, writes Pending only |
| Share link | anyone with the URL | `/share/analysis/[token]` | 256-bit random token, SHA-256 stored, expiry ≤ 1 year, revocable, rate-limited, PII-free rows, `no-referrer` |
| Metrics feed | company website | `/api/public/metrics` | bearer key (hashed), rotation, rate limit, counts only, optional CORS origin |
| Scheduler | Hostinger cron | `/api/cron/*` | `CRON_SECRET` bearer, constant-time compare, idempotent jobs |
| Server ↔ Supabase (secret key) | server only | `serviceClient()` | only after code-level checks; key never in `NEXT_PUBLIC_*`; secret scanner in CI |

## 2. Permission matrix

| Capability | Rep | Admin | Enforced in |
|---|---|---|---|
| See own leads, their calls/notes | ✅ | ✅ (all) | RLS `crm_enquiries_read` |
| See another rep's lead | ❌ (unless a transfer is offered to them) | ✅ | RLS |
| Available Leads (limited fields) | ✅ | ✅ | `available_leads()` |
| Claim unclaimed lead | ✅ (first wins) | ✅ | `claim_enquiry` row lock |
| Edit / move stage / log call / delete own lead | ✅ | ✅ | `require_owner_or_admin` |
| Reassign owner directly | ❌ (use transfer) | ✅ | `update_enquiry` |
| Propose / cancel transfer | own leads | ✅ | `propose_transfer`, `cancel_transfer` |
| Accept / decline transfer | if addressed to them | ✅ | `respond_transfer` |
| Submit New Enquiry / Bulk Import | ✅ | ✅ | `create_pending_enquiry`, `bulk_create_pending` |
| Approve / reject pending | ❌ | ✅ | `require_admin` |
| Edit pending row | own submission | ✅ | `update_pending_enquiry` |
| Customers list | customers of own leads | all | RLS + `list_customers` |
| Edit customer | if they own one of its leads | ✅ | `update_customer` |
| Reports, team performance, audit log, jobs | ❌ | ✅ | `require_admin` |
| Users, roles, activation, password reset | ❌ | ✅ (not self-demote; ≥1 admin) | server + `admin_update_profile` |
| Team roster, settings, holidays, share links, metrics key | ❌ | ✅ | `require_admin` |
| Restore deleted / archive / unarchive | ❌ | ✅ | `require_admin` |
| Meta import | ❌ | ✅ (or scheduled job) | `import_external_leads` |
| OMS order / PI / payment | own leads | ✅ | `oms_begin_order` + RLS read |
| Export CSV | own leads | all | RLS; audited |

## 3. Threat model (STRIDE-style)

| Threat | Mitigation | Test |
|---|---|---|
| Unauthenticated data access | anon has no grants; proxy + DAL redirects | security.test `anon cannot read/execute` |
| Privilege escalation via request body | role never trusted from client; owner from session; owner change admin-only | `reps cannot reassign`, `admin-only actions` |
| Broken object-level authorization (IDOR) | RLS on every table; RPC ownership checks | `rep sees only own`, `cannot mutate another rep's lead` |
| Cross-user leakage via aggregates | `scope_owner()` forces rep scope in every aggregate | `dashboard: rep asking for another owner` |
| SQL injection | parameterised RPCs; PostgREST filters escaped (`safeSearch`); no dynamic SQL from input | unit + review |
| XSS | React escaping; no `dangerouslySetInnerHTML`; Leaflet tooltip HTML escaped; CSP nonce + `strict-dynamic` | review |
| CSRF | Server Actions origin check (Next); cookie `SameSite=Lax`; GET routes are read-only | framework |
| SSRF | only fixed outbound hosts (OMS from env, postalpincode with digits-only path, Google APIs) | review |
| Session theft/fixation | Supabase HttpOnly cookies; logout revokes refresh token; password change signs out other devices; optional TOTP MFA (`REQUIRE_ADMIN_MFA`) | manual |
| Brute force | login limited per IP (20/15 min) and per account (8/15 min); MFA 10/15 min; generic errors; timing padding for unknown usernames | manual |
| Inactive users | `profiles.active` checked in every policy/RPC; Auth ban on deactivate | `deactivated users lose access immediately` |
| Sensitive logs | `logServerError` redacts phones, emails, JWTs, secret keys; no bodies logged | unit (redact) |
| Unsafe uploads | PDF only, magic-byte check, ≤10 MB, private bucket, random object names, signed URLs (60 s) | review |
| Spreadsheet formula injection | neutralised on import (`sanitizeCell`) and export (`toCsv`) | imports.test |
| Duplicate submissions / races | idempotency keys (public form, calls, OMS), row locks, unique constraints | workflows.test |
| Webhook/cron spoofing | constant-time bearer check; endpoints disabled without `CRON_SECRET` | review |
| Exposed secrets | `check-secrets.js` (Supabase secret, JWT, DB URL, private keys) + gitleaks | CI |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (legacy allowed all — SEC-10) | header check |
| Public PII exposure | share/metrics rows carry no names/phones/owners/values; public duplicate-phone check removed | workflows.test |
| Security-definer bypass | every definer function has `search_path=''`; EXECUTE allow-list | `no SECURITY DEFINER without search_path`, `EXECUTE grants allow-list` |

## 4. Headers

CSP (per request, `src/proxy.ts`): `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <tile host>; font-src 'self';
connect-src 'self' <supabase>; frame-src 'none'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`.
Static (next.config.ts): HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `COOP: same-origin`, restrictive
`Permissions-Policy`, no `X-Powered-By`. `'unsafe-inline'` for **styles** is a deliberate trade-off
for chart/map style attributes; scripts remain nonce-locked.

## 5. Key management

| Secret | Where | Rotation |
|---|---|---|
| `SUPABASE_SECRET_KEY` | hosting env only | Supabase → API keys → roll, update env, restart |
| `RATE_LIMIT_SALT`, `CRON_SECRET` | hosting env | rotate any time (cron config must follow) |
| OMS token, SMTP password, Google key | hosting env | per provider |
| Share-link tokens / metrics key | only hashes in DB; plaintext shown once | Admin Settings |

## 6. Legacy findings → new design

| Legacy | New CRM |
|---|---|
| SEC-01 anonymous maintenance functions | no anon grants; maintenance is admin RPC + audited |
| SEC-02 shared admin PIN | no PIN; individual accounts + optional MFA |
| SEC-03 broad sheet sharing | data in Postgres behind RLS; no spreadsheet editors |
| SEC-04 hardcoded share key | hashed, expiring, revocable links |
| SEC-06 authorization gaps | RLS + owner checks on every read/write (BUG-019/020 fixed) |
| SEC-07 public endpoints | rate limits, honeypot, idempotency, no PII leak |
| SEC-08 PDFs shared publicly | private bucket + signed URLs |
| SEC-09 weak credentials, logout | Supabase Auth (bcrypt), session revocation, password policy |
| SEC-10 ALLOWALL framing | frame-ancestors 'none' |
| SEC-11 stored HTML via stage | stage CHECK + React escaping |
| SEC-13 PII in URLs/email | digest without phones; WhatsApp links are user-initiated |
| SEC-14 weak audit trail | `private.audit_log` for every sensitive action, actor from session |

## 7. Test results (2026-10-23, local)

`npm run test:db` → **51/51 pass**, including 16 dedicated security tests; `npm run test:unit` → 19/19;
`npm audit --omit=dev` → 0 vulnerabilities. RLS was tested on PGlite with the Supabase role model **and** verified on the live project after
applying the migrations (no anon access, no authenticated write grants, server-only functions not
exposed, all tables RLS-enabled, private bucket). E2E on the live project: 10/10, including a rep being
refused another rep's enquiry URL and admin pages.

## 8. Unresolved risks (release blockers marked ⛔)

| Risk | Status |
|---|---|
| Synthetic E2E records/accounts in the live project | remove before go-live |
| Supabase advisor WARN ×46 (definer functions executable by authenticated) | accepted by design (ADR-0003) |
| Supabase Auth settings (password length, leaked-password protection, email templates, site URL) must be set in the dashboard | owner/admin task — DEPLOYMENT doc |
| Repository is public (SEC-15) | recommend making it private |
| `lookupPincode` is callable without login (needed by the public form) — rate-limited, returns public postal data only | accepted |
| OSM tile usage policy for production traffic | consider a commercial tile provider |
