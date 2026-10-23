# ADR-0002 — Request-time rendering; Cache Components off

**Status:** accepted

**Context.** Next.js 16 offers Cache Components. Almost every CRM page shows per-user,
RLS-filtered data; a shared server cache keyed incorrectly would leak one user's data to another.
A per-request CSP nonce also requires dynamic rendering.

**Decision.** `cacheComponents` is not enabled. Pages render per request; lists paginate and
aggregate in SQL so pages stay fast without shared caches.

**Consequences.** Simpler correctness model; revisit only for public, user-independent pages.
