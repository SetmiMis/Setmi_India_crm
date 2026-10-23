#!/usr/bin/env tsx
/*
 * Creates (or resets) the synthetic end-to-end test accounts: one admin and two reps, named
 * "E2E Admin", "E2E Rep One", "E2E Rep Two" (emails at the reserved example.com domain).
 * Generated passwords are written ONLY to .env.local (git-ignored) as E2E_* variables and are
 * never printed.  Remove with --remove (deactivates + bans; data they created stays, tagged E2E).
 *   npx tsx --env-file=.env.local scripts/e2e-accounts.ts
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const ENV = path.join(__dirname, "..", ".env.local");
const accounts = [
  { key: "ADMIN", username: "e2e.admin", name: "E2E Admin", role: "admin" },
  { key: "REP1", username: "e2e.rep1", name: "E2E Rep One", role: "rep" },
  { key: "REP2", username: "e2e.rep2", name: "E2E Rep Two", role: "rep" },
] as const;

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data?.users.find((u) => u.email === email);
    if (hit || !data || data.users.length < 200) return hit ?? null;
  }
  return null;
}

async function main() {
  const remove = process.argv.includes("--remove");
  const lines: string[] = [];
  for (const a of accounts) {
    const email = `${a.username}@example.com`;
    let user = await findUser(email);
    if (remove) {
      if (user) {
        await sb.from("profiles").update({ active: false }).eq("id", user.id);
        await sb.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
      }
      continue;
    }
    const password = randomBytes(18).toString("base64url") + "9z";
    if (!user) {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: a.name } });
      if (error || !data.user) throw error ?? new Error("createUser failed");
      user = data.user;
      const { error: pErr } = await sb.rpc("admin_create_profile", {
        p_user_id: user.id, p_username: a.username, p_full_name: a.name, p_role: a.role, p_email: email, p_actor: null,
      });
      if (pErr) throw pErr;
    } else {
      await sb.auth.admin.updateUserById(user.id, { password, ban_duration: "none" });
      await sb.from("profiles").update({ active: true, role: a.role }).eq("id", user.id);
    }
    lines.push(`E2E_${a.key}_LOGIN=${a.username}`, `E2E_${a.key}_PASSWORD=${password}`);
  }
  if (!remove) {
    const kept = fs.readFileSync(ENV, "utf8").split(/\r?\n/).filter((l) => !l.startsWith("E2E_"));
    fs.writeFileSync(ENV, [...kept.filter(Boolean), "# Synthetic E2E test accounts (generated; never commit)", ...lines, ""].join("\n"));
  }
  console.log(remove ? "E2E accounts deactivated." : `E2E accounts ready (${accounts.length}); credentials written to .env.local only.`);
}

main().catch((e) => {
  console.error("Failed:", (e as Error).message);
  process.exit(1);
});
