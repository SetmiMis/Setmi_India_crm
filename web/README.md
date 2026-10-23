# SETMI INDIA CRM — web app

Next.js 16 front end and server for the modernized CRM. Start with the repository
[README](../README.md), then [docs/LOCAL_SETUP.md](../docs/LOCAL_SETUP.md).

| Command | Purpose |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build (standalone) / run it |
| `npm run lint` · `npm run typecheck` | static checks |
| `npm run test:unit` · `npm run test:db` | unit tests · database/RLS tests on PGlite |
| `npm run ci` | everything above |
| `npm run gen:reference` | regenerate states/pincodes from the legacy source |
| `npx tsx scripts/migrate.ts --dir <exports>` | legacy data migration dry run (see docs/DATA_MIGRATION.md) |
