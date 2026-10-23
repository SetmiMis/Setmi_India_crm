import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";
import { MfaVerifyForm } from "@/components/mfa-forms";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export default async function MfaPage() {
  const supabase = await userClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp?.find((f) => f.status === "verified");
  if (!factor) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-2 font-display text-xl font-bold">Two-step verification</h1>
      <p className="mb-4 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <MfaVerifyForm factorId={factor.id} from="login" />
      <form action={signOut} className="mt-3">
        <Button type="submit" variant="ghost" size="sm">
          Use a different account
        </Button>
      </form>
    </>
  );
}
