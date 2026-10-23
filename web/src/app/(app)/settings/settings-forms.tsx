"use client";

import { removeMfaFactor, updatePassword } from "@/server/actions/auth";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function ChangePasswordForm() {
  const { state, formAction, pending, err, formRef } = useFormAction(updatePassword, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="space-y-3">
      <Field label="New password" name="password" error={err("password")} hint="At least 10 characters, letters and numbers" required>
        <Input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
      </Field>
      <Field label="Confirm new password" name="confirm" error={err("confirm")} required>
        <Input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
      </Field>
      <p className="text-xs text-muted">Other devices are signed out after a change.</p>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
      <FormMessage state={state} />
    </form>
  );
}

export function RemoveMfaForm({ factorId }: { factorId: string }) {
  const { state, formAction, pending } = useFormAction(removeMfaFactor);
  return (
    <form onSubmit={submitTo(formAction, () => window.confirm("Remove your authenticator? Your account becomes password-only."))}>
      <input type="hidden" name="factorId" value={factorId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>Remove authenticator</Button>
      <FormMessage state={state} />
    </form>
  );
}
