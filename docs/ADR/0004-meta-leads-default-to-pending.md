# ADR-0004 — Meta Ads leads go to Pending Approvals by default (configurable)

**Status:** accepted, owner may override

**Context.** The legacy Apps Script importer inserted Meta leads straight into Enquiries (unclaimed),
while a second external importer put them into Pending. The modernization brief requires that
imports do not silently bypass approval.

**Decision.** Default target is Pending Approvals with source `Meta Ads` (new source value; legacy
used `Other` + a Notes tag). Admins can switch to the legacy behaviour in Admin Settings
(`meta_import_target = enquiries`). Dedup by `(source, external_id)` primary key.
