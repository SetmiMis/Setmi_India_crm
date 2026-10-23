#!/usr/bin/env tsx
/*
 * Creates the FIRST admin login (one-off). Further users are created from Users & Team in the app.
 *   npx tsx --env-file=.env.local scripts/bootstrap-admin.ts --email owner@company.com --username owner --name "Owner Name"
 *
 * The account gets a random password that is never printed. The owner then uses
 * "Forgot password?" on the login page to choose their own password (Supabase emails the link).
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = arg("email")?.trim().toLowerCase();
const username = arg("username")?.trim().toLowerCase();
const name = arg("name")?.trim();
if (!email || !username || !name || !/^[a-z0-9._-]{3,40}$/.test(username)) {
  console.error('Usage: --email <email> --username <a-z0-9._-> --name "Full Name"');
  process.exit(2);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: existing } = await sb.from("profiles").select("id").eq("role", "admin").limit(1);
  if (existing?.length && !process.argv.includes("--allow-additional")) {
    console.error("An admin already exists — create more users from the app (Users & Team).");
    process.exit(1);
  }
  const { data, error } = await sb.auth.admin.createUser({
    email: email!,
    password: randomBytes(24).toString("base64url") + "a1",
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const { error: pErr } = await sb.rpc("admin_create_profile", {
    p_user_id: data.user.id, p_username: username, p_full_name: name, p_role: "admin", p_email: email, p_actor: null,
  });
  if (pErr) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw pErr;
  }
  console.log(`Admin "${username}" created. Open /forgot-password, enter ${email}, and set your password from the emailed link.`);
}

main().catch((e) => {
  console.error("Bootstrap failed:", (e as Error).message);
  process.exit(1);
});
