# Redactions in `src/` (history) and deploy prerequisites

## History

The baseline export of the production project "E2O FMS" (2026-10-20, tag `baseline-2026-10-20`,
commit `2a27f0f`) differed from production in exactly two places. In each, a credential literal was
replaced with a placeholder:

| File | Production value | Placeholder in the baseline |
|---|---|---|
| `src/Analysis.js` | the live `?page=analysis&key=…` share key (`ANALYSIS_SHARE_KEY_`) | `__REDACTED_ANALYSIS_SHARE_KEY__` |
| `src/Code.js` | the default Admin PIN that `migrateAdminPinToProperties_()` seeded | `__REDACTED_DEFAULT_PIN__` |

**Both placeholders are gone** since the SEC-01/02/04 change:
- The share key is read from Script property `ANALYSIS_SHARE_KEY`.
- The default-PIN seed was removed.

There are no redactions in `src/` any more. When diffing against a `clasp pull` of a production
project that does not have that change yet, expect these two spots (and the rest of that change)
to differ.

## Before the first `clasp push` / deploy of this tree

1. Set Script property **`ANALYSIS_SHARE_KEY`**, either from the menu (Set Analysis Share Link Key)
   or in Project Settings. Use the current live key to keep existing share links working, or a
   new key of at least 16 characters to rotate.
2. Decide on **`ALLOW_PIN_LOGIN`**. Leave it unset to disable the shared PIN once users exist, or
   set it to `YES` to keep the PIN working.
3. Expect every user to be signed out once, because the session cache prefix was bumped.

`npm run check:secrets` fails CI if either old literal is ever reintroduced.
