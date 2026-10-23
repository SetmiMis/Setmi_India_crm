# Operations and maintenance

## Monitoring

* Uptime: poll `GET /api/health` every 5 min (UptimeRobot/BetterStack). 503 = database unreachable.
* Logs: the app writes one-line JSON errors (`{"level":"error","scope":…}`) with phones, emails and
  tokens redacted. Read them in the Hostinger app logs. Supabase → Logs for database/auth.
* Jobs: **Admin Settings → Scheduled jobs** shows the last 50 runs (daily digest, Meta import) with
  status; failed runs can be retried by calling the cron endpoint again (idempotent).
* Audit trail: **Admin Settings → Audit trail** (approvals, stage moves, claims, transfers, deletes,
  exports, settings, user changes).
* Supabase advisors (security + performance) after every schema change.

## Backups and restore

* Supabase daily backups (and PITR on Pro plans). Before every migration or bulk import, take a
  manual backup (Database → Backups) or `pg_dump` with the session pooler URL.
* Restore drill (quarterly): restore the latest backup into a scratch project, run
  `reconcile` counts / dashboard totals, record the result.
* Storage bucket `enquiry-documents` is included in Supabase backups only on some plans — export
  periodically if PDFs are business-critical.

## Common tasks

| Task | Where |
|---|---|
| Add / deactivate a user, reset a password | Users & Team |
| Add a Lead By name without a login | Users & Team → roster |
| Company holiday (skipped by follow-up dates) | Admin Settings |
| Where Meta leads land; call soft limit; archive age; digest recipients | Admin Settings |
| Create / revoke a Data Analysis share link | Admin Settings |
| Rotate the website metrics key | Admin Settings (update the website immediately) |
| Archive old closed-out enquiries / restore one | Admin Settings / enquiry page |
| Restore a deleted enquiry | Pipeline → Show: Deleted → open → Restore |
| Rotate `SUPABASE_SECRET_KEY` | Supabase → API keys → roll → update Hostinger env → redeploy |

## Incident response

1. Suspected account compromise: deactivate the user (immediate RLS lock-out + Auth ban), reset
   password, review the audit trail for their actions, rotate secrets if a server key may be exposed.
2. Data mistake: find it in the audit trail; correct via the app; for bulk damage restore from backup
   into a scratch project and copy back the affected rows.
3. Outage: check `/api/health`, Supabase status, Hostinger status; roll back to the previous deploy.
4. Record the incident (date, impact, cause, fix) in the repository wiki/issues (no customer data).

## Upgrades

* Monthly: `npm outdated`, `npm audit`; update in a branch; run `npm run ci`; deploy to staging first.
* Next.js majors: read `web/node_modules/next/dist/docs` upgrade notes (the project uses Next 16
  conventions: `proxy.ts`, async `cookies()/params`).
* Schema changes: new migration file only (never edit applied files); add/adjust `tests/db`.
