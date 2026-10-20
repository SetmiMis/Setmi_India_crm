# 14 — Branded Subdomain and Production Readiness

**Decision status:** nothing has been decided and **no DNS changes have been made**. The final
subdomain and hosting architecture are open.

## Constraints of Apps Script web apps [V/H; verify with current Google documentation before acting]

- A web app is served only from `script.google.com/macros/s/<id>/exec`. The UI runs inside a
  sandboxed iframe on `*.googleusercontent.com`. **There is no supported way to map an `/exec`
  URL to a custom domain** (no CNAME or TLS-on-custom-domain option).
- Reverse-proxying `/exec` through your own domain is not a supported pattern. It depends on
  Google's redirects, cookies and iframe origins, and it can break without notice. **Not
  recommended.**
- Supported ways to get a branded address therefore either (a) put a branded page in front of the
  Apps Script app, or (b) move to a hosting architecture that supports custom domains.

## Options

| # | Option | How | Pros | Cons |
|---|---|---|---|---|
| 1 | **Branded redirect** | `crm.<domain>` → HTTP 301/302 to the `/exec` URL (DNS host or CDN redirect rule) | Hours to set up; no code change; easy rollback | The address bar shows script.google.com after the redirect; branding only at entry |
| 2 | **Google Sites with custom domain** embedding the web app | New Site → Embed the `/exec` URL → Sites custom domain (domain verification + CNAME to `ghs.googlehosted.com`) | Branded URL stays in the address bar; Google-managed TLS; no server to run | iframe-in-iframe (small-screen and UX limits); the app still needs anonymous or organization access; Sites custom domains have Workspace requirements |
| 3 | **Static branded shell** on a static host (for example the existing Vercel account) with an iframe | Small page on `crm.<domain>` iframes `/exec` (works because `ALLOWALL` is set) | Full control of the landing page, headers, analytics | Same iframe limits; another system to maintain; `ALLOWALL` is itself a weak point (SEC-10) |
| 4 | **Migrate to a hosted application** (for example the existing Next.js/Vercel port, with Sheets or a database backend) | Separate approved project | Real custom domain, proper auth (Google SSO / OIDC), server-side authorization, logs, staging, CI/CD | Weeks of work; data migration; re-test every workflow in 05; dual-running period |

**Recommendation:**
- **Short term:** Option 1 or 2, done **after** the critical security fixes (SEC-01, SEC-02,
  SEC-05). A memorable URL makes an anonymous endpoint easier to find.
- **Long term:** evaluate Option 4 as a separate, approved project. The Next.js port that already
  writes to this workbook may be a starting point. [?] Its status is unknown.

## Subdomain naming candidates

`crm.<domain>`, `sales.<domain>`, `fms.<domain>`, `leads.<domain>`.

The staff email domain is `setmiindia.org` [V: Drive sharing list]. [?] The company may use
another public website domain. The owner should confirm which domain is canonical.

## Prerequisites to confirm

| Item | Owner of answer |
|---|---|
| Registrar and DNS host for the domain; who can change records | SETMI IT / owner |
| Whether the domain is verified in Google Workspace / Search Console (needed for Sites custom domain) | Workspace admin |
| Intended audience: staff only, or public field form too | Business owner |
| Access model: Google SSO for staff vs app passwords | Business owner |

## TLS, access and privacy

- Options 1–3: TLS on the branded host is handled by the DNS/CDN, Google Sites or the static
  host. The app itself stays on Google TLS.
- For staff-only use, the cleanest access control is **web app access = "Anyone within
  <domain>"**, so Google authenticates staff. That requires every rep to have a Workspace account
  and the public field form to move to a separate public deployment. **This is a design decision**
  that needs approval and fits well with fixing SEC-01 and SEC-02.

## Monitoring, logging, backup

- **Errors:** Cloud Logging (`exceptionLogging: STACKDRIVER`). Set up an email alert on error rate
  in the linked GCP project (needs a standard GCP project linked to the script).
- **Executions:** Apps Script dashboard → Executions; check daily for failures of the digest and
  Meta import.
- **Uptime:** an external check on `?page=metrics&key=` (counts only) or on the `/exec` status
  code.
- **Backup and recovery:** see 10.

## Go-live checklist (for any branded URL)

- [ ] SEC-01 fixed (no anonymous state-changing functions) and the guard test added
- [ ] SEC-02 PIN removed or rotated; SEC-04 share key moved to properties and rotated
- [ ] SEC-03 sharing reviewed; SEC-05 Deployment B archived
- [ ] Repo private, `main` protected, CI green, baseline tagged
- [ ] Staging exists; regression checklist R1–R21 passed on the release candidate
- [ ] Workbook backup taken; rollback steps (12) rehearsed once on staging
- [ ] DNS change reviewed by the domain owner; TTL lowered beforehand; old URL keeps working
- [ ] Monitoring and alerts on; owner and on-call contact named
- [ ] Users told the new URL; old bookmarks still work (the `/exec` URL is unchanged)

## Migration and rollback risks

| Risk | Mitigation |
|---|---|
| Redirect or Sites misconfiguration | Keep the `/exec` URL as the canonical fallback; rollback = remove the DNS record |
| Moving to "Anyone within domain" breaks the public field form and external reps | Separate public intake deployment; verify every rep account first |
| Full migration (Option 4) diverges from the Sheets business rules | Use docs 03/05 + characterization tests as the spec; run both systems in parallel for a period |
