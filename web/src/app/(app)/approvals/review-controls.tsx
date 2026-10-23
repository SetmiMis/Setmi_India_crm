"use client";

import { approvePending, rejectPending, updatePending } from "@/server/actions/approvals";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { PRIORITIES, TIMELINES } from "@/lib/domain/constants";

type Team = Array<{ id: string; name: string }>;

export function ReviewControls({ id, defaultOwner, team }: { id: string; defaultOwner: string; team: Team }) {
  const approve = useFormAction(approvePending);
  const reject = useFormAction(rejectPending);
  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <form onSubmit={submitTo(approve.formAction)} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <Field label="Assign to (optional)" name={`owner-${id}`} hint="Empty = goes to Available Leads">
          <Select id={`owner-${id}`} name="owner_id" options={team.map((t) => ({ value: t.id, label: t.name }))} placeholder="Unassigned" defaultValue={defaultOwner} />
        </Field>
        <Button type="submit" variant="success" className="w-full" disabled={approve.pending}>{approve.pending ? "Approving…" : "Approve"}</Button>
        <FormMessage state={approve.state} />
      </form>
      <form onSubmit={submitTo(reject.formAction)} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <Field label="Reject reason" name={`reason-${id}`} error={reject.err("reason")}>
          <Input id={`reason-${id}`} name="reason" maxLength={500} required placeholder="Spam, duplicate, wrong number…" />
        </Field>
        <Button type="submit" variant="danger" className="w-full" disabled={reject.pending}>{reject.pending ? "Rejecting…" : "Reject"}</Button>
        <FormMessage state={reject.state} />
      </form>
    </div>
  );
}

export function PendingEditForm({ row, sources, team }: { row: Record<string, unknown> & { id: string }; sources: string[]; team: Team }) {
  const { state, formAction, pending, err } = useFormAction(updatePending);
  const v = (k: string) => (row[k] == null ? "" : String(row[k]));
  return (
    <form onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <input type="hidden" name="id" value={row.id} />
      <Field label="Name" name="customer_name" error={err("customer_name")}><Input name="customer_name" defaultValue={v("customer_name")} required maxLength={120} /></Field>
      <Field label="Company" name="company"><Input name="company" defaultValue={v("company")} maxLength={120} /></Field>
      <Field label="Phone" name="phone" error={err("phone")}><Input name="phone" defaultValue={v("phone")} required maxLength={20} /></Field>
      <Field label="Email" name="email" error={err("email")}><Input name="email" defaultValue={v("email")} maxLength={120} /></Field>
      <Field label="GSTIN" name="gst" error={err("gst")}><Input name="gst" defaultValue={v("gst")} maxLength={15} /></Field>
      <Field label="Pincode" name="pincode" error={err("pincode")}><Input name="pincode" defaultValue={v("pincode")} maxLength={6} /></Field>
      <Field label="City" name="city"><Input name="city" defaultValue={v("city")} maxLength={80} /></Field>
      <Field label="District" name="district"><Input name="district" defaultValue={v("district")} maxLength={80} /></Field>
      <Field label="State" name="state"><Input name="state" defaultValue={v("state")} maxLength={80} /></Field>
      <Field label="Source" name="source"><Select name="source" options={sources} defaultValue={v("source")} /></Field>
      <Field label="Priority" name="priority"><Select name="priority" options={PRIORITIES} defaultValue={v("priority")} placeholder="—" /></Field>
      <Field label="Lead By" name="owner_id"><Select name="owner_id" options={team.map((t) => ({ value: t.id, label: t.name }))} defaultValue={v("owner_id")} placeholder="Unassigned" /></Field>
      <Field label="Qty" name="qty" error={err("qty")}><Input name="qty" defaultValue={v("qty")} inputMode="decimal" /></Field>
      <Field label="Timeline" name="timeline"><Select name="timeline" options={TIMELINES} defaultValue={v("timeline")} placeholder="—" /></Field>
      <Field label="Est. value" name="est_value" error={err("est_value")}><Input name="est_value" defaultValue={v("est_value")} inputMode="decimal" /></Field>
      <Field label="Requirement" name="requirement" className="sm:col-span-3"><Textarea name="requirement" defaultValue={v("requirement")} maxLength={1000} /></Field>
      <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea name="notes" defaultValue={v("notes")} maxLength={4000} /></Field>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save corrections"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
