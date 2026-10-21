# 11 — GitHub and Branching Strategy

## Repository state at audit time [V 2026-10-20]

| Item | State |
|---|---|
| Repo | `SetmiMis/Setmi_India_crm` |
| Visibility | **Public** (see SEC-15; recommend making it **private**) |
| Branches | `main` only |
| Commits | 1: `b78855a` "Initial commit" (2026-10-21 02:30 IST), containing only `README.md` (`# Setmi_India_crm`) |
| Workflows | none |
| Branch protection | not verified. The available tooling cannot read protection rules. The owner should check Settings → Branches |

The audit work sits on the branch `docs/initial-audit`, as a **local commit only, not pushed**.
It adds files and changes only `README.md`, from its single heading to the full README. History
is preserved.

## Branch model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Always equals what is (or is about to be) in production | Protected: PR required, ≥1 approving review, CI `validate` + `gitleaks` must pass, no force-push, no deletion, linear history (squash merge) |
| `fix/<bug-id>-<slug>` | One bug from 08 | Short-lived, from `main` |
| `feat/<slug>` | Approved feature | Short-lived |
| `docs/<slug>` | Documentation only | |
| `hotfix/<slug>` | Urgent production fix | Same PR rules; may be released before other merged work only if `main` == prod |

There is no long-lived `develop` branch: the team is small and releases are manual.

## Commits

- Imperative subject ≤72 characters, referencing the register ID where one applies:
  `Fix logCall duplicate IDs (BUG-003)`.
- Body: why, which sheets and columns are affected, migration or rollback notes.
- One logical change per commit. Never include data exports or secrets. `npm run check:secrets`
  and gitleaks enforce part of this.

## Pull requests

Every PR description covers:

1. What and why (link the BUG/SEC ID)
2. Affected modules, sheets and columns
3. Tests added or updated, plus `npm run ci` output
4. Regression checklist rows run on staging (R#)
5. Deployment and rollback plan
6. Docs updated (Y/N and which)

Review requirements:
- At least 1 reviewer who did not write the change.
- For security-sensitive files (auth in `Code.js`, `appsscript.json`, `.github/`), the owner's
  approval. Add a `CODEOWNERS` file once reviewers are named.

## Releases and tags

- **Tag format:** `vYYYY.MM.DD-N` (for example `v2026.10.28-1`), tagged on the `main` commit that
  was deployed.
- **Release notes:** the changes, the Apps Script **version number** it was deployed as, the
  deployment ID, the tester, and the regression results.
- The Apps Script version description should carry the git tag and commit SHA, so production
  can be traced back to git.

## Initial baseline commit (proposed, pending approval)

1. **Owner:** set the repo to private.
2. Push `docs/initial-audit` and open a PR into `main`. CI runs on GitHub for the first time.
3. Review and merge, then tag `baseline-2026-10-20` (production as found, two values redacted).
4. Enable branch protection on `main`.
