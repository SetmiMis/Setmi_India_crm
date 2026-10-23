"use client";

import { signIn } from "@/server/actions/auth";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const { state, formAction, pending } = useFormAction(signIn);
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-3">
      <Field label="Username or email" name="login" required>
        <Input name="login" autoComplete="username" required autoFocus maxLength={120} />
      </Field>
      <Field label="Password" name="password" required>
        <Input name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      <FormMessage state={state} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
