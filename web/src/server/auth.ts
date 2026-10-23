import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type CurrentUser = {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "rep";
  memberId: string | null;
  isAdmin: boolean;
  aal: "aal1" | "aal2";
  hasMfa: boolean;
};

/**
 * Data Access Layer entry point. Verifies the session JWT (getClaims validates the signature),
 * then loads the profile under RLS. Inactive accounts resolve to null even with a valid JWT.
 * Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await userClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const sub = claimsData?.claims?.sub;
  if (error || !sub) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, role, active")
    .eq("id", sub)
    .maybeSingle();
  if (!profile || !profile.active) return null;
  const { data: member } = await supabase.from("team_members").select("id").eq("profile_id", sub).maybeSingle();
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name,
    role: profile.role,
    memberId: member?.id ?? null,
    isAdmin: profile.role === "admin",
    aal: (aalData?.currentLevel ?? "aal1") as "aal1" | "aal2",
    hasMfa: aalData?.nextLevel === "aal2",
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A user who enrolled an authenticator must complete it for this session.
  if (user.hasMfa && user.aal !== "aal2") redirect("/login/mfa");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/dashboard?denied=1");
  if (env().REQUIRE_ADMIN_MFA === "true" && !user.hasMfa) redirect("/settings?mfa=required");
  return user;
}
