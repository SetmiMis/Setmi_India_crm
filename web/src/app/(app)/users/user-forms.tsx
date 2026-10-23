"use client";

import { addTeamMember, adminResetPassword, createUser } from "@/server/actions/admin";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function CreateUserForm() {
  const { state, formAction, pending, err, formRef } = useFormAction(createUser, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Full name (as shown on leads)" name="full_name" error={err("full_name")} required><Input name="full_name" required maxLength={80} /></Field>
      <Field label="Username" name="username" error={err("username")} required hint="a–z, 0–9, . _ -"><Input name="username" required maxLength={40} autoComplete="off" /></Field>
      <Field label="Email" name="email" error={err("email")} required><Input name="email" type="email" required maxLength={120} autoComplete="off" /></Field>
      <Field label="Role" name="role"><Select name="role" options={[{ value: "rep", label: "Sales rep" }, { value: "admin", label: "Admin" }]} defaultValue="rep" /></Field>
      <Field label="Temporary password" name="password" error={err("password")} required hint="10+ characters with letters and numbers" className="sm:col-span-2">
        <Input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create login"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ResetPasswordForm({ id }: { id: string }) {
  const { state, formAction, pending, err, formRef } = useFormAction(adminResetPassword, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="password" type="password" aria-label="New password" placeholder="New password" required minLength={10} maxLength={128} autoComplete="new-password" error={err("password")} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Set password</Button>
      <FormMessage state={state} />
    </form>
  );
}

export function AddTeamMemberForm() {
  const { state, formAction, pending, err, formRef } = useFormAction(addTeamMember, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="flex flex-wrap items-end gap-2">
      <Field label="Add name (no login)" name="name" error={err("name")} className="flex-1"><Input name="name" required maxLength={80} /></Field>
      <Button type="submit" size="sm" disabled={pending}>Add</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}
