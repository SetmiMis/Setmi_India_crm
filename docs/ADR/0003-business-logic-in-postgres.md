# ADR-0003 — Business rules and authorization in Postgres functions; RLS on every table

**Status:** accepted

**Context.** The legacy app had races (lost updates, duplicate IDs) and authorization holes because
checks lived in one layer. Supabase exposes the database through its Data API, so any rule enforced
only in Next.js could be bypassed with a user token.

**Decision.** Clients get SELECT under RLS only. Every write is a `SECURITY DEFINER` function with
`search_path=''` that authorizes the caller, locks rows and runs in one transaction. Server-only
functions are granted to `service_role` only. Tests run the real migrations on PGlite with the
Supabase role model.

**Consequences.** Rules are testable in SQL and identical for every client. Business changes need a
migration (reviewed, versioned).
