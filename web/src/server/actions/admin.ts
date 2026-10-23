"use server";

import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { callRpc } from "@/server/rpc";
import { serviceClient } from "@/lib/supabase/server";
import { fieldErrors, newUserSchema, passwordSchema } from "@/lib/domain/validation";
import { fromDbError, invalid, logServerError, type ActionResult } from "@/lib/errors";
import { env } from "@/lib/env";

type Prev = ActionResult<unknown> | null;
const uuid = z.uuid();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------- Users (Supabase Auth admin API — server only) ----------

export async function createUser(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = newUserSchema.safeParse({
    username: fd.get("username"),
    full_name: fd.get("full_name"),
    email: fd.get("email"),
    password: fd.get("password"),
    role: fd.get("role"),
  });
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const strong = passwordSchema.safeParse(parsed.data.password);
  if (!strong.success) return invalid("Choose a stronger password", { password: strong.error.issues[0].message });

  const svc = serviceClient();
  const { data: taken } = await svc.from("profiles").select("id").eq("username", parsed.data.username).maybeSingle();
  if (taken) return invalid("That username is taken", { username: "Already taken" });

  const { data, error } = await svc.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (error || !data.user) {
    return invalid(error?.message?.includes("already") ? "That email already has an account" : "Could not create the login", {
      email: "Check the email",
    });
  }
  const { error: pErr } = await svc.rpc("admin_create_profile", {
    p_user_id: data.user.id,
    p_username: parsed.data.username,
    p_full_name: parsed.data.full_name,
    p_role: parsed.data.role,
    p_email: parsed.data.email,
    p_actor: admin.id,
  });
  if (pErr) {
    // Roll back the auth user so no orphan login exists.
    await svc.auth.admin.deleteUser(data.user.id);
    return fromDbError(pErr);
  }
  refresh();
  return { ok: true, message: `User ${parsed.data.username} created. Share the password privately; they can change it in Settings.` };
}

export async function updateUser(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing user");
  const role = fd.get("role") ? z.enum(["admin", "rep"]).safeParse(fd.get("role")) : null;
  if (role && !role.success) return invalid("Invalid role");
  const activeRaw = fd.get("active");
  const active = activeRaw === "true" ? true : activeRaw === "false" ? false : null;

  const svc = serviceClient();
  const { error } = await svc.rpc("admin_update_profile", {
    p_user_id: id.data,
    p_role: role?.success ? role.data : null,
    p_active: active,
    p_actor: admin.id,
  });
  if (error) return fromDbError(error);
  if (active !== null) {
    // Banning also invalidates refresh tokens, so deactivation bites on the next token refresh;
    // RLS (profiles.active) already blocks data access immediately.
    const { error: banErr } = await svc.auth.admin.updateUserById(id.data, { ban_duration: active ? "none" : "876000h" });
    if (banErr) logServerError("ban", banErr);
  }
  refresh();
  return { ok: true, message: "User updated." };
}

export async function adminResetPassword(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = uuid.safeParse(fd.get("id"));
  const pw = passwordSchema.safeParse(fd.get("password"));
  if (!id.success) return invalid("Missing user");
  if (!pw.success) return invalid("Choose a stronger password", { password: pw.error.issues[0].message });
  const svc = serviceClient();
  const { error } = await svc.auth.admin.updateUserById(id.data, { password: pw.data });
  if (error) return { ok: false, code: "internal", message: "Could not reset the password." };
  const { error: aErr } = await svc.rpc("audit_event", {
    p_actor: admin.id, p_action: "user.password_reset", p_entity: "profile", p_entity_id: id.data, p_details: {},
  });
  if (aErr) logServerError("audit", aErr);
  refresh();
  return { ok: true, message: "Password reset. Share it privately; ask them to change it after signing in." };
}

// ---------- Team roster ----------

export async function addTeamMember(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const name = z.string().trim().min(1).max(80).safeParse(fd.get("name"));
  if (!name.success) return invalid("Enter a name", { name: "Enter a name" });
  const r = await callRpc("admin_add_team_member", { p_name: name.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Team member added." };
}

export async function setTeamMemberActive(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing team member");
  const r = await callRpc("admin_set_team_member_active", { p_id: id.data, p_active: fd.get("active") === "true" });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Saved." };
}

// ---------- Settings / holidays ----------

export async function saveSettings(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const target = z.enum(["pending", "enquiries"]).safeParse(fd.get("meta_import_target"));
  const soft = z.coerce.number().int().min(1).max(50).safeParse(fd.get("calls_soft_limit"));
  const months = z.coerce.number().int().min(1).max(120).safeParse(fd.get("archive_after_months"));
  const emails = String(fd.get("digest_recipients") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const badEmail = emails.find((e) => !z.email().safeParse(e).success);
  if (!target.success || !soft.success || !months.success) return invalid("Check the values");
  if (badEmail || emails.length > 20) return invalid("Digest recipients must be up to 20 valid emails", { digest_recipients: "Invalid email list" });
  for (const [k, v] of [
    ["meta_import_target", target.data],
    ["calls_soft_limit", soft.data],
    ["archive_after_months", months.data],
    ["digest_recipients", emails],
  ] as const) {
    const r = await callRpc("admin_set_setting", { p_key: k, p_value: v });
    if (!r.ok) return r;
  }
  refresh();
  return { ok: true, message: "Settings saved." };
}

export async function setHoliday(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const day = z.iso.date().safeParse(fd.get("day"));
  if (!day.success) return invalid("Pick a date", { day: "Pick a date" });
  const present = fd.get("present") !== "false";
  const r = await callRpc("admin_set_holiday", { p_day: day.data, p_label: String(fd.get("label") ?? ""), p_present: present });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: present ? "Holiday saved — follow-up dates will skip it." : "Holiday removed." };
}

// ---------- Share links & metrics key: the plaintext token is shown ONCE, only its hash is stored ----------

export async function createShareLink(_prev: Prev, fd: FormData): Promise<ActionResult<{ url: string }>> {
  await requireAdmin();
  const days = z.coerce.number().int().min(1).max(365).safeParse(fd.get("days"));
  if (!days.success) return invalid("Expiry must be 1–365 days", { days: "1–365" });
  const token = randomBytes(32).toString("base64url");
  const r = await callRpc<string>("admin_create_share_link", {
    p_token_hash: sha256(token),
    p_label: String(fd.get("label") ?? "").slice(0, 120),
    p_expires_at: new Date(Date.now() + days.data * 86_400_000).toISOString(),
  });
  if (!r.ok) return r;
  refresh();
  const base = env().APP_BASE_URL ?? "";
  return { ok: true, data: { url: `${base}/share/analysis/${token}` }, message: "Share link created. Copy it now — it will not be shown again." };
}

export async function revokeShareLink(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing link");
  const r = await callRpc("admin_revoke_share_link", { p_id: id.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Link revoked." };
}

export async function rotateMetricsKey(_prev: Prev, fd: FormData): Promise<ActionResult<{ key: string | null }>> {
  await requireAdmin();
  const disable = fd.get("disable") === "true";
  const key = disable ? null : randomBytes(32).toString("base64url");
  const r = await callRpc("admin_set_metrics_key", { p_key_hash: key ? sha256(key) : null, p_label: "website" });
  if (!r.ok) return r;
  refresh();
  return {
    ok: true,
    data: { key },
    message: key ? "New metrics key created. Update the website now — the old key stopped working." : "Public metrics feed disabled.",
  };
}
