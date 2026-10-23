import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-4 font-display text-xl font-bold">Sign in</h1>
      <LoginForm />
      <p className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-cyan-dk hover:underline">
          Forgot password?
        </Link>
      </p>
    </>
  );
}
