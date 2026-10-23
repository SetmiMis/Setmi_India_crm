import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth";
import { userClient } from "@/lib/supabase/server";
import { setTheme } from "@/server/actions/auth";
import { PageHeader, Card, DefinitionList, Notice } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { MfaEnroll } from "@/components/mfa-forms";
import { ChangePasswordForm, RemoveMfaForm } from "./settings-forms";

export const metadata: Metadata = { title: "My Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const supabase = await userClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.filter((f) => f.status === "verified") ?? [];
  const theme = (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
  return (
    <>
      <PageHeader title="My Settings" />
      {s.mfa === "required" ? <div className="mb-4"><Notice tone="warn">Admins must set up an authenticator app before using admin pages.</Notice></div> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <DefinitionList items={[["Name", user.fullName], ["Username", `@${user.username}`], ["Role", user.role], ["Linked to Lead By", user.memberId ? "Yes" : "No — ask an admin"]]} />
          <form action={setTheme} className="mt-4 flex items-center gap-2">
            <input type="hidden" name="theme" value={theme === "dark" ? "light" : "dark"} />
            <Button type="submit" variant="secondary" size="sm">Switch to {theme === "dark" ? "light" : "dark"} mode</Button>
          </form>
        </Card>
        <Card title="Change password"><ChangePasswordForm /></Card>
        <Card title="Two-step verification (authenticator app)">
          {verified.length ? (
            <div className="space-y-2 text-sm">
              <p>✅ An authenticator is set up. You will be asked for a code when you sign in.</p>
              {verified.map((f) => <RemoveMfaForm key={f.id} factorId={f.id} />)}
            </div>
          ) : (
            <MfaEnroll />
          )}
        </Card>
      </div>
    </>
  );
}
