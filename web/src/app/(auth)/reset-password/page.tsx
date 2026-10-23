"use client";

import Link from "next/link";
import { updatePassword } from "@/server/actions/auth";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export default function ResetPasswordPage() {
  const { state, formAction, pending, err } = useFormAction(updatePassword, { resetOnSuccess: true });
  return (
    <>
      <h1 className="mb-4 font-display text-xl font-bold">Choose a new password</h1>
      <form onSubmit={submitTo(formAction)} className="space-y-3">
        <Field label="New password" name="password" error={err("password")} hint="At least 10 characters, letters and numbers" required>
          <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        </Field>
        <Field label="Confirm password" name="confirm" error={err("confirm")} required>
          <Input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
        </Field>
        <FormMessage state={state} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </Button>
      </form>
      {state?.ok ? (
        <p className="mt-4 text-center text-sm">
          <Link href="/dashboard" className="text-cyan-dk hover:underline">
            Continue to the CRM
          </Link>
        </p>
      ) : null}
    </>
  );
}
