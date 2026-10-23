import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await searchParams;
  // If Supabase falls back to the Site URL (redirect URL not allow-listed yet), forward the
  // recovery/email code to the confirm handler instead of dropping it.
  const code = typeof s.code === "string" ? s.code : null;
  if (code && /^[\w-]{10,200}$/.test(code)) redirect(`/auth/confirm?code=${encodeURIComponent(code)}&next=/reset-password`);
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
