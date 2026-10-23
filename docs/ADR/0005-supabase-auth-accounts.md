# ADR-0005 — Supabase Auth with individual accounts; no shared PIN; optional TOTP

**Status:** accepted

**Context.** Legacy auth: Users sheet with salted SHA-256 plus a shared admin PIN (SEC-02), sessions
in CacheService, logout did not revoke.

**Decision.** Supabase Auth (bcrypt, refresh-token rotation, revocation) with `profiles` for role and
active flag. Admins create accounts; public sign-up disabled. Username or email login.
`REQUIRE_ADMIN_MFA=true` forces admins to enrol TOTP. Legacy password hashes are not migrated;
accounts are re-created.
