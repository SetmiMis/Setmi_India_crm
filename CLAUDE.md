# Instructions for AI coding agents

This is a live Google Apps Script + Google Sheets CRM. Before any change, read
`docs/09_AI_DEVELOPER_GUIDE.md` (mandatory rules) and the docs it points to, then verify against `src/`.

Key rules:
- Any top-level function in `src/*.js` without a trailing `_` is callable anonymously from the internet.
- Never push/deploy to the production script, edit the live workbook, or change sharing/properties/triggers without explicit approval.
- Never commit secrets, `.clasp.json`/`.clasprc.json`, or real customer data.
- Run `npm run ci` before proposing a change; update docs/03, 05, 07, 08 when behaviour or schema changes.
