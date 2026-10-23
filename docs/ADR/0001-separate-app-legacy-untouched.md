# ADR-0001 — Build the new CRM beside the legacy app, in `web/` + `supabase/`

**Status:** accepted (2026-10-23)

**Context.** `src/` is the clasp `rootDir` of the live Apps Script project, and its checks
(structure, syntax, contract tests) depend on that layout. The production Apps Script URL must stay
independently accessible and unchanged.

**Decision.** The Next.js app lives in `web/`, database migrations in `supabase/`. Nothing in `src/`
changes. The two systems use separate data stores; no dual-write.

**Consequences.** Hostinger must deploy from the `web/` sub-directory (or a deploy branch/zip). The
legacy app remains a working fallback until cutover.
