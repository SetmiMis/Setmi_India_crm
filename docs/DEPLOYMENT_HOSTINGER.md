# Deployment — Hostinger (subdomain to be confirmed)

**Status:** deployment-ready build verified locally (standalone server). **Not deployed.** The
hostname, Hostinger plan and DNS are not decided — nothing here changes DNS, the main website, email
(MX) or the legacy Apps Script URL.

## 1. Plan compatibility (verified against Hostinger's guide, 2026-10-23)

Hostinger runs Node.js web apps on **Business Web Hosting** and **Cloud Startup / Professional /
Enterprise / Enterprise Plus**; Next.js is a supported framework; Node 18/20/22/24 are offered;
deploys come from a GitHub repository or a .zip upload, npm build runs automatically, and the last
two successful deployments are kept. Single/Premium shared hosting **cannot** run this app. A VPS
also works (manual setup, §5). [?] Confirm which plan SETMI INDIA has.

Requirements of this app: Node ≥ 20.9 (choose **22.x**), server-side rendering, Route Handlers,
Server Actions, ~512 MB RAM, outbound HTTPS to Supabase (and OMS/Google/SMTP if used).

## 2. Prerequisites

1. Supabase project for production with migrations + seed applied (DATA_MIGRATION.md / LOCAL_SETUP.md).
2. Supabase Auth settings: Site URL = `https://<subdomain>`; redirect URL
   `https://<subdomain>/auth/confirm`; minimum password length 10; enable leaked-password protection
   (plan permitting); disable public sign-ups (**Authentication → Sign In / Providers → Allow new
   users to sign up: off** — accounts are created by admins).
3. Environment values (`web/.env.example`).

## 3. Hostinger Node.js app (Business / Cloud plan)

1. hPanel → **Websites → Add website → Node.js Web App**.
2. Deployment source:
   * **Import Git Repository** → this repository → branch `main` (after merge) → set the
     **root/application directory to `web`** if the form offers it. [?] Not confirmed that
     Hostinger's importer supports a sub-directory; if it does not, use a deploy branch whose root
     is the contents of `web/` (`git subtree split --prefix web -b deploy-web`) or the .zip upload.
   * or **Upload your website files** → zip the *contents* of `web/` without `node_modules` and `.next`.
3. Build settings: framework **Next.js**, Node **22.x**, build command `npm run build`, start command
   `npm start` (runs `.next/standalone/server.js`; it reads `PORT` from the environment). For the
   "Other" preset: output directory `.next/standalone`, entry file `server.js`.
4. Environment variables: add every variable from `.env.example` with production values.
   `APP_BASE_URL=https://<subdomain>`. Mark `SUPABASE_SECRET_KEY`, `CRON_SECRET`, SMTP/OMS/Google
   secrets as secret where the panel allows.
5. Deploy, then attach the **subdomain** in hPanel (Domains → Subdomains / the app's domain
   settings). Only an `A`/`CNAME` record for the new subdomain is added — no change to the apex
   domain, the main website or MX records. Enable the free SSL certificate (HTTPS).
6. Scheduled jobs (hPanel → Advanced → **Cron Jobs**), times in server time — adjust to 09:00 IST:
   ```
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<subdomain>/api/cron/daily-digest
   */30 * * * *  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<subdomain>/api/cron/meta-import
   ```
   (Store the secret in the cron command only if the panel keeps it private; otherwise use an
   external scheduler such as a Supabase scheduled function or a GitHub Actions schedule.)

## 4. Smoke test (after every deploy)

| Check | Expected |
|---|---|
| `GET /api/health` | 200 `{"status":"ok","db":"ok"}` |
| `GET /login` | 200, `content-security-policy` header present, HSTS present |
| `GET /dashboard` signed out | 307 → /login |
| Sign in as admin, open Dashboard, Pipeline, an enquiry | data visible |
| Sign in as a rep | only own leads; Reports/Users not in menu; `/reports` redirects |
| Public `/enquiry` submit | "Thank you"; row appears in Pending Approvals |
| `POST /api/cron/daily-digest` without token | 401 |
| `GET /api/public/metrics` without key | 401 |
| Legacy Apps Script URL | unchanged and working |

## 5. VPS alternative

Ubuntu + Node 22 + PM2 + Nginx (TLS via Certbot):
`npm ci && npm run build` → `PORT=3000 pm2 start .next/standalone/server.js --name setmi-crm` →
Nginx `proxy_pass http://127.0.0.1:3000;` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
and `X-Forwarded-Proto`/`Host` (needed for rate limiting and Server Action origin checks).

## 6. Release and rollback

* Release: merge to `main` → tag `web-vYYYY.MM.DD` → Hostinger redeploy → smoke test.
* App rollback: redeploy the previous successful deployment (Hostinger keeps the last two) or the
  previous tag.
* Database: migrations are additive. To roll back a bad migration, apply a reviewed down-migration;
  restore from Supabase backups/PITR for data incidents (OPERATIONS_AND_MAINTENANCE.md).
* The legacy Apps Script app remains the fallback until cutover is signed off.
