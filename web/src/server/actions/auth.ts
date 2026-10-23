"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { userClient, serviceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { clientIp, rateLimit, rateLimitStatus } from "@/server/rate-limit";
import { fieldErrors, passwordSchema } from "@/lib/domain/validation";
import { invalid, logServerError, type ActionResult } from "@/lib/errors";
import { getCurrentUser } from "@/server/auth";

const GENERIC_LOGIN_ERROR = "Wrong username/email or password.";

const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(3).max(120),
  password: z.string().min(1).max(128),
});

/** Sign in with username OR email. Rate-limited per IP and per account. */
export async function signIn(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ login: fd.get("login"), password: fd.get("password") });
  if (!parsed.success) return invalid(GENERIC_LOGIN_ERROR);
  const { login, password } = parsed.data;
  const ip = await clientIp();
  const byIp = await rateLimitStatus("login-ip", [ip], 20, 15 * 60);
  const byUser = byIp === "unavailable" ? byIp : await rateLimitStatus("login-user", [login], 8, 15 * 60);
  if (byIp === "unavailable" || byUser === "unavailable") {
    return { ok: false, code: "unavailable", message: "Sign-in is temporarily unavailable. Please try again in a minute." };
  }
  if (byIp !== "ok" || byUser !== "ok") {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Wait 15 minutes and try again." };
  }

  let email = login;
  if (!login.includes("@")) {
    const { data } = await serviceClient().from("profiles").select("email, active").eq("username", login).maybeSingle();
    if (!data?.email || !data.active) {
      await new Promise((r) => setTimeout(r, 400)); // same timing shape as a failed password check
      return invalid(GENERIC_LOGIN_ERROR);
    }
    email = data.email;
  }

  const supabase = await userClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return invalid(GENERIC_LOGIN_ERROR);

  const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { ok: false, code: "forbidden", message: "This account is not active. Contact an administrator." };
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") redirect("/login/mfa");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await userClient();
  // scope "local" revokes this session's refresh token on the server (fixes legacy BUG-021).
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/** Always answers the same way so it cannot be used to discover accounts. */
export async function requestPasswordReset(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const email = z.email().safeParse(String(fd.get("email") ?? "").trim().toLowerCase());
  const generic: ActionResult = { ok: true, message: "If that email belongs to an account, a reset link is on its way." };
  if (!email.success) return generic;
  const ip = await clientIp();
  if (!(await rateLimit("pw-reset", [ip], 5, 3600)) || !(await rateLimit("pw-reset-email", [email.data], 3, 3600))) {
    return generic;
  }
  const base = env().APP_BASE_URL;
  if (!base) {
    logServerError("pw-reset", new Error("APP_BASE_URL not set"));
    return generic;
  }
  const supabase = await userClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${base}/auth/confirm?next=/reset-password` });
  if (error) logServerError("pw-reset", error);
  return generic;
}

export async function updatePassword(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Your reset link expired. Request a new one." };
  const pw = passwordSchema.safeParse(fd.get("password"));
  if (!pw.success) return invalid("Choose a stronger password", fieldErrors(pw.error));
  if (fd.get("password") !== fd.get("confirm")) return invalid("Passwords do not match", { confirm: "Passwords do not match" });
  const supabase = await userClient();
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return invalid(error.message.includes("same") ? "Choose a different password" : "Could not update the password");
  // Sign out other devices after a password change.
  await supabase.auth.signOut({ scope: "others" });
  return { ok: true, message: "Password updated." };
}

// ---------- MFA (TOTP) ----------

export async function startMfaEnrollment(): Promise<ActionResult<{ factorId: string; qr: string; secret: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  const supabase = await userClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `SETMI CRM ${Date.now()}` });
  if (error || !data) return { ok: false, code: "internal", message: "Could not start authenticator setup." };
  return { ok: true, data: { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret } };
}

const codeSchema = z.object({ factorId: z.string().min(10), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

export async function verifyMfa(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const parsed = codeSchema.safeParse({ factorId: fd.get("factorId"), code: fd.get("code") });
  if (!parsed.success) return invalid("Enter the 6-digit code", fieldErrors(parsed.error));
  const ip = await clientIp();
  if (!(await rateLimit("mfa", [ip, parsed.data.factorId], 10, 15 * 60))) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Wait 15 minutes." };
  }
  const supabase = await userClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return invalid("That code did not match. Try the latest code.");
  if (fd.get("from") === "login") redirect("/dashboard");
  return { ok: true, message: "Authenticator verified." };
}

export async function removeMfaFactor(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return { ok: false, code: "forbidden", message: "Verify with your authenticator first." };
  if (user.isAdmin && env().REQUIRE_ADMIN_MFA === "true") {
    return { ok: false, code: "forbidden", message: "Admins must keep an authenticator while MFA is required." };
  }
  const factorId = String(fd.get("factorId") ?? "");
  const supabase = await userClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { ok: false, code: "internal", message: "Could not remove the authenticator." };
  return { ok: true, message: "Authenticator removed." };
}

export async function setTheme(fd: FormData): Promise<void> {
  const t = fd.get("theme") === "dark" ? "dark" : "light";
  (await cookies()).set("theme", t, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
}
