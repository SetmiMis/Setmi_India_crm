"use client";

import Link from "next/link";
import { requestPasswordReset } from "@/server/actions/auth";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const { state, formAction, pending } = useFormAction(requestPasswordReset);
  return (
    <>
      <h1 className="mb-2 font-display text-xl font-bold">Reset password</h1>
      <p className="mb-4 text-sm text-muted">We will email a reset link to the address on your account.</p>
      <form onSubmit={submitTo(formAction)} className="space-y-3">
        <Field label="Email" name="email" required>
          <Input name="email" type="email" autoComplete="email" required maxLength={120} />
        </Field>
        <FormMessage state={state} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-cyan-dk hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
