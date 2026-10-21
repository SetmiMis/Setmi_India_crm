# Redactions in `src/`

`src/` is a verbatim export of the production Apps Script project **"E2O FMS"** taken on
**2026-10-20** (Drive API export `application/vnd.google-apps.script+json`; project last modified
2026-10-07 05:49 UTC). It has exactly **two** deliberate differences from production. In both,
a credential literal was replaced with a placeholder so it never enters git history:

| File | Line (approx.) | Production value | Placeholder in git |
|---|---|---|---|
| `src/Analysis.js` | 16 | the live `?page=analysis&key=…` share key | `__REDACTED_ANALYSIS_SHARE_KEY__` |
| `src/Code.js` | 1351 | the default Admin PIN that `migrateAdminPinToProperties_()` seeds into Script Properties | `__REDACTED_DEFAULT_PIN__` |

File naming: Apps Script `.gs` files are stored as `.js`, which is how `clasp pull` writes them.
Apps Script treats both the same way.

## ⚠ Do not `clasp push` this tree as-is

Pushing `src/` unchanged would replace the live share key with the placeholder, which breaks the
existing public analysis link. It would also change the seed PIN. Before the first push from git,
an approved change must move both values out of source and into Script Properties (for example
`ANALYSIS_SHARE_KEY`). After that the placeholders go away and this file can be deleted. See
`docs/13_ENVIRONMENTS_AND_DEPLOYMENT.md` and `docs/07_SECURITY_AND_RISKS.md` (SEC-04).

`npm run check:secrets` fails CI if either literal is ever reintroduced.
