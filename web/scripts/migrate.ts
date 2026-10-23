#!/usr/bin/env tsx
/*
 * Legacy Google Sheets → Supabase migration CLI.
 *
 *   Dry run (default — touches NO database):
 *     npx tsx scripts/migrate.ts --dir "D:\exports\e2o-2026-11-01"
 *
 *   Apply (only after the dry-run report is reviewed and the owner approves):
 *     set DATABASE_URL=postgresql://...   (Supabase → Connect → Session pooler; never commit it)
 *     npx tsx scripts/migrate.ts --dir "D:\exports\..." --apply --confirm-target <project-ref>
 *
 * Input: one CSV per sheet, exported by the owner (File → Download → CSV), named exactly
 *   Enquiries.csv, Archive.csv (optional), PendingEnquiries.csv, Customers.csv, FollowUps.csv,
 *   CallLog.csv, Team.csv, Users.csv
 * Keep the export folder OUTSIDE the repository — it contains customer data.
 * Output (written into the export folder): migration-report.md, migration-report.json,
 *   migration-issues.csv, users_to_create.csv (no passwords).
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { Client } from "pg";
import { transform, type Row, type SheetInput } from "../src/lib/migration/transform";
import { applyMigration, reconcile } from "../src/lib/migration/apply";
import { toCsv } from "../src/lib/domain/imports";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dir = arg("dir");
const apply = process.argv.includes("--apply");
if (!dir || !fs.existsSync(dir)) {
  console.error("Usage: tsx scripts/migrate.ts --dir <export-folder> [--apply --confirm-target <project-ref>]");
  process.exit(2);
}
if (path.resolve(dir).startsWith(path.resolve(__dirname, "..", ".."))) {
  console.error("Refusing to read exports from inside the repository. Move the folder outside the repo.");
  process.exit(2);
}

function readSheet(name: string, required: boolean): Row[] {
  const file = path.join(dir!, `${name}.csv`);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing ${name}.csv`);
    return [];
  }
  const parsed = Papa.parse<Row>(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), { header: true, skipEmptyLines: false, transformHeader: (h) => h.trim() });
  if (parsed.errors.length) console.warn(`${name}.csv: ${parsed.errors.length} CSV parse warning(s), first: ${parsed.errors[0].message}`);
  return parsed.data;
}

async function main() {
  const input: SheetInput = {
    enquiries: readSheet("Enquiries", true),
    archive: readSheet("Archive", false),
    pending: readSheet("PendingEnquiries", true),
    customers: readSheet("Customers", true),
    followups: readSheet("FollowUps", true),
    calllog: readSheet("CallLog", true),
    team: readSheet("Team", true),
    users: readSheet("Users", false),
  };
  const t = transform(input);

  let md = `# Migration report — ${new Date().toISOString()}\n\nMode: **${apply ? "APPLY" : "DRY RUN (no database changes)"}**\n\n`;
  md += "| Entity | Source rows | Valid | Rejected | Duplicates | Missing required | Fixes applied |\n|---|---|---|---|---|---|---|\n";
  for (const [k, r] of Object.entries(t.report)) {
    md += `| ${k} | ${r.source_rows} | ${r.valid} | ${r.rejected} | ${r.duplicates} | ${r.missing_required} | ${r.mapping_fixes} |\n`;
  }
  md += "\n## Notes\n\n" + Object.entries(t.report).flatMap(([k, r]) => r.notes.map((n) => `- **${k}**: ${n}`)).join("\n") + "\n";
  md += `\nEvery issue (row number, id, what happened) is listed in migration-issues.csv (${t.issues.length} rows).\n`;

  if (apply) {
    const target = arg("confirm-target");
    const url = process.env.DATABASE_URL;
    if (!url || !target || !url.includes(target)) {
      console.error("--apply needs DATABASE_URL and --confirm-target <project-ref> that appears in DATABASE_URL.");
      process.exit(2);
    }
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query("begin");
      const counts = await applyMigration(client, t);
      const rec = await reconcile(client, t);
      if (!rec.ok) throw new Error(`Reconciliation failed: ${JSON.stringify(rec.differences)}`);
      await client.query("commit");
      md += `\n## Applied\n\nInserted this run: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}\n\nReconciliation: ✅ every migrated code is present (${JSON.stringify(rec.found)}).\n`;
    } catch (e) {
      await client.query("rollback");
      md += `\n## Apply FAILED — rolled back, nothing was changed\n\n${(e as Error).message}\n`;
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  }

  fs.writeFileSync(path.join(dir!, "migration-report.md"), md);
  fs.writeFileSync(path.join(dir!, "migration-report.json"), JSON.stringify({ report: t.report, counters: t.counters }, null, 2));
  fs.writeFileSync(path.join(dir!, "migration-issues.csv"), toCsv(["entity", "row", "id", "kind", "detail"], t.issues.map((i) => [i.entity, i.row, i.id, i.kind, i.detail])));
  fs.writeFileSync(path.join(dir!, "users_to_create.csv"), toCsv(["username", "full_name", "role", "active"], t.users.map((u) => [u.username, u.full_name, u.role, u.active])));
  console.log(md);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
