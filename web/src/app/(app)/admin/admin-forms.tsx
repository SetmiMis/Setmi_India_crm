"use client";

import { useState } from "react";
import { createShareLink, rotateMetricsKey, saveSettings, setHoliday } from "@/server/actions/admin";
import { archiveClosed } from "@/server/actions/enquiries";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function SettingsForm({ settings }: { settings: Record<string, unknown> }) {
  const { state, formAction, pending, err } = useFormAction(saveSettings);
  const recipients = Array.isArray(settings.digest_recipients) ? (settings.digest_recipients as string[]).join(", ") : "";
  return (
    <form onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Meta Ads leads go to" name="meta_import_target" hint="Legacy Apps Script sent them straight to Available Leads">
        <Select name="meta_import_target" defaultValue={String(settings.meta_import_target ?? "pending")}
          options={[{ value: "pending", label: "Pending Approvals (reviewed)" }, { value: "enquiries", label: "Available Leads (no review)" }]} />
      </Field>
      <Field label="Calls per enquiry before asking to confirm" name="calls_soft_limit"><Input name="calls_soft_limit" type="number" min={1} max={50} defaultValue={String(settings.calls_soft_limit ?? 6)} /></Field>
      <Field label="Archive closed-out enquiries after (months)" name="archive_after_months"><Input name="archive_after_months" type="number" min={1} max={120} defaultValue={String(settings.archive_after_months ?? 6)} /></Field>
      <Field label="Daily digest recipients" name="digest_recipients" error={err("digest_recipients")} hint="Comma-separated; empty = all active admins" className="sm:col-span-2">
        <Textarea name="digest_recipients" defaultValue={recipients} maxLength={2000} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" disabled={pending}>Save settings</Button><FormMessage state={state} /></div>
    </form>
  );
}

export function HolidayForm() {
  const { state, formAction, pending, err, formRef } = useFormAction(setHoliday, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="flex flex-wrap items-end gap-2">
      <Field label="Date" name="day" error={err("day")}><Input type="date" name="day" required /></Field>
      <Field label="Label" name="label" className="flex-1"><Input name="label" maxLength={80} placeholder="Diwali" /></Field>
      <input type="hidden" name="present" value="true" />
      <Button type="submit" size="sm" disabled={pending}>Add holiday</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function ArchiveForm({ defaultMonths }: { defaultMonths: number }) {
  const { state, formAction, pending } = useFormAction(archiveClosed);
  return (
    <form onSubmit={submitTo(formAction, () => window.confirm("Archive all Won/Lost/Dispatched/Closed enquiries older than this? They stay searchable under Pipeline → Show: Archived and can be restored."))}
      className="flex flex-wrap items-end gap-2">
      <Field label="Older than (months)" name="months"><Input type="number" name="months" min={1} max={120} defaultValue={String(defaultMonths)} /></Field>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Archiving…" : "Archive now"}</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex gap-2">
      <Input readOnly value={value} aria-label="Secret value" onFocus={(e) => e.target.select()} />
      <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}

export function ShareLinkForm() {
  const { state, formAction, pending, err } = useFormAction(createShareLink);
  const url = state?.ok ? (state.data as { url: string } | undefined)?.url : undefined;
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Label" name="label" className="flex-1"><Input name="label" maxLength={120} placeholder="Marketing team" /></Field>
        <Field label="Valid for (days)" name="days" error={err("days")}><Input name="days" type="number" min={1} max={365} defaultValue="30" /></Field>
        <Button type="submit" size="sm" disabled={pending}>Create link</Button>
      </div>
      <FormMessage state={state} />
      {url ? <CopyBox value={url} /> : null}
    </form>
  );
}

export function MetricsKeyForm({ active }: { active: boolean }) {
  const { state, formAction, pending } = useFormAction(rotateMetricsKey);
  const key = state?.ok ? (state.data as { key: string | null } | undefined)?.key : undefined;
  return (
    <div className="space-y-2">
      <form onSubmit={submitTo(formAction, () => !active || window.confirm("Rotate the key? The website stops working until it uses the new key."))}>
        <Button type="submit" size="sm" disabled={pending}>{active ? "Rotate key" : "Create key"}</Button>
      </form>
      {active ? (
        <form onSubmit={submitTo(formAction)}><input type="hidden" name="disable" value="true" /><Button type="submit" size="sm" variant="ghost" disabled={pending}>Disable feed</Button></form>
      ) : null}
      <FormMessage state={state} />
      {key ? <CopyBox value={key} /> : null}
    </div>
  );
}
