"use client";

import { useMemo, useState } from "react";
import { addNote, logCall, moveStage, proposeTransfer, updateEnquiry } from "@/server/actions/enquiries";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { CALL_STATUSES, ESCALATIONS, INTEREST_LEVELS, PRIORITIES, TIMELINES, gradeFor } from "@/lib/domain/constants";
import { todayIST } from "@/lib/domain/dates";

type Team = Array<{ id: string; name: string }>;

export function CallLogForm({ id, callsSoFar }: { id: string; callsSoFar: number }) {
  // A fresh request id per mounted form makes double-submits and retries idempotent.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { state, formAction, pending, err, formRef } = useFormAction(logCall, { resetOnSuccess: true });
  const [status, setStatus] = useState("");
  const next = callsSoFar + 1;
  const over = next > 6;
  return (
    <form
      ref={formRef}
      onSubmit={submitTo(formAction, () => {
        if (over && !window.confirm(`This will be call ${next} — past the usual 6. Log it anyway?`)) return false;
        // The id already in the submitted form data is used; prepare a fresh one for the next call.
        setTimeout(() => setRequestId(crypto.randomUUID()), 0);
        return true;
      })}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="client_request_id" value={requestId} />
      <p className="text-sm text-muted sm:col-span-2">Call {next} of 6{over ? " (extra)" : ""}. The next follow-up is calculated from priority unless you pick a date.</p>
      <Field label="Call status" name="call_status" error={err("call_status")} required>
        <Select name="call_status" required options={CALL_STATUSES} placeholder="Choose…" value={status} onChange={(e) => setStatus(e.target.value)} />
      </Field>
      <Field label="Customer interest" name="interest" hint={status && status !== "Connected" ? "Only recorded when the call connected" : undefined}>
        <Select name="interest" options={INTEREST_LEVELS} placeholder="—" disabled={status !== "Connected"} />
      </Field>
      <Field label="Call date" name="call_date" error={err("call_date")}>
        <Input type="date" name="call_date" max={todayIST()} defaultValue={todayIST()} />
      </Field>
      <Field label="Next follow-up (optional)" name="next_follow_up" error={err("next_follow_up")}>
        <Input type="date" name="next_follow_up" min={todayIST()} />
      </Field>
      <Field label="Remarks" name="remarks" className="sm:col-span-2">
        <Textarea name="remarks" maxLength={1000} placeholder="What did the customer say?" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Log call"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const { state, formAction, pending, err, formRef } = useFormAction(addNote, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Field label="Add a note" name="note" error={err("note")}>
        <Textarea name="note" maxLength={2000} required />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function StageMoveForm({ id, version, stage, options }: { id: string; version: number; stage: string; options: string[] }) {
  const [to, setTo] = useState(options[0] ?? "");
  const { state, formAction, pending, err } = useFormAction(moveStage);
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <Field label={`From ${stage} to`} name="stage">
        <Select name="stage" options={options} value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {to === "Quoted" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Quote no." name="quote_no"><Input name="quote_no" maxLength={60} placeholder="SETMI-Q-…" /></Field>
          <Field label="Quote amount (₹)" name="quote_amount" error={err("quote_amount")}><Input name="quote_amount" inputMode="decimal" /></Field>
        </div>
      ) : null}
      {to === "Won" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Invoice no." name="invoice_no" error={err("invoice_no")} required><Input name="invoice_no" maxLength={60} required /></Field>
          <Field label="Order value (₹)" name="order_value" error={err("order_value")}><Input name="order_value" inputMode="decimal" /></Field>
        </div>
      ) : null}
      {to === "Lost" ? (
        <Field label="Lost reason" name="lost_reason" error={err("lost_reason")} required>
          <Input name="lost_reason" maxLength={500} required list="lost-reasons" />
          <datalist id="lost-reasons">
            <option value="Price too high" /><option value="Bought elsewhere" /><option value="No requirement now" />
            <option value="Not reachable" /><option value="Product not available" />
          </datalist>
        </Field>
      ) : null}
      {to === "Dispatched" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Dispatch date" name="dispatch_date"><Input type="date" name="dispatch_date" defaultValue={todayIST()} /></Field>
          <Field label="Weight (kg)" name="shipment_weight" error={err("shipment_weight")}><Input name="shipment_weight" inputMode="decimal" /></Field>
          <Field label="Courier / LR / details" name="dispatch_info" className="col-span-2"><Input name="dispatch_info" maxLength={500} /></Field>
        </div>
      ) : null}
      {to === "Closed" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Feedback rating" name="feedback_rating" error={err("feedback_rating")}><Select name="feedback_rating" options={["5", "4", "3", "2", "1"]} placeholder="—" /></Field>
          <Field label="Feedback note" name="feedback_note"><Input name="feedback_note" maxLength={1000} /></Field>
        </div>
      ) : null}
      {to === "Quoted" || to === "Follow-up" ? (
        <Field label="Next follow-up (optional)" name="next_follow_up"><Input type="date" name="next_follow_up" min={todayIST()} /></Field>
      ) : null}
      <Field label="Note (optional)" name="note"><Input name="note" maxLength={1000} /></Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !to}>{pending ? "Moving…" : `Move to ${to}`}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function TransferForm({ id, team }: { id: string; team: Team }) {
  const { state, formAction, pending, err } = useFormAction(proposeTransfer);
  return (
    <form onSubmit={submitTo(formAction)} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Field label="Transfer to" name="to_member" error={err("to_member")} hint="They must accept before the lead moves.">
        <Select name="to_member" required options={team.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose a team member" />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Sending…" : "Propose transfer"}</Button>
      <FormMessage state={state} />
    </form>
  );
}

type EditProps = {
  enquiry: Record<string, string | number | boolean> & { id: string; version: number; isOpen: boolean };
  sources: string[];
  team: Team | null;
};

export function EditEnquiryForm({ enquiry: e, sources, team }: EditProps) {
  const { state, formAction, pending, err } = useFormAction(updateEnquiry);
  const [qty, setQty] = useState(String(e.qty ?? ""));
  const [timeline, setTimeline] = useState(String(e.timeline ?? ""));
  const grade = useMemo(() => gradeFor(Number(qty) || null, timeline), [qty, timeline]);
  const v = (k: string) => String(e[k] ?? "");
  return (
    <form onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={e.id} />
      <input type="hidden" name="version" value={e.version} />
      <Field label="Customer name" name="customer_name" error={err("customer_name")} required><Input name="customer_name" defaultValue={v("customer_name")} required maxLength={120} /></Field>
      <Field label="Company" name="company"><Input name="company" defaultValue={v("company")} maxLength={120} /></Field>
      <Field label="Phone" name="phone" error={err("phone")} required><Input name="phone" defaultValue={v("phone")} required inputMode="tel" maxLength={20} /></Field>
      <Field label="Email" name="email" error={err("email")}><Input name="email" type="email" defaultValue={v("email")} maxLength={120} /></Field>
      <Field label="GSTIN" name="gst" error={err("gst")}><Input name="gst" defaultValue={v("gst")} maxLength={15} /></Field>
      <Field label="Pincode" name="pincode" error={err("pincode")}><Input name="pincode" defaultValue={v("pincode")} inputMode="numeric" maxLength={6} /></Field>
      <Field label="City / area" name="city"><Input name="city" defaultValue={v("city")} maxLength={80} /></Field>
      <Field label="District" name="district"><Input name="district" defaultValue={v("district")} maxLength={80} /></Field>
      <Field label="State" name="state"><Input name="state" defaultValue={v("state")} maxLength={80} /></Field>
      <Field label="Source" name="source"><Select name="source" options={sources} defaultValue={v("source")} /></Field>
      <Field label="Requirement" name="requirement" className="sm:col-span-2"><Textarea name="requirement" defaultValue={v("requirement")} maxLength={1000} /></Field>
      <Field label="Qty (metres/units)" name="qty" error={err("qty")}><Input name="qty" inputMode="decimal" value={qty} onChange={(x) => setQty(x.target.value)} /></Field>
      <Field label="Buyer timeline" name="timeline" hint={grade ? `Grade ${grade}` : "Grade needs Qty + Timeline"}>
        <Select name="timeline" options={TIMELINES} placeholder="—" value={timeline} onChange={(x) => setTimeline(x.target.value)} />
      </Field>
      <Field label="Escalation" name="escalation"><Select name="escalation" options={ESCALATIONS} placeholder="None" defaultValue={v("escalation")} /></Field>
      {e.isOpen ? (
        <>
          <Field label="Priority" name="priority" hint="Changing it recalculates the next follow-up"><Select name="priority" options={PRIORITIES} defaultValue={v("priority")} placeholder="—" /></Field>
          <Field label="Next follow-up" name="next_follow_up" error={err("next_follow_up")}><Input type="date" name="next_follow_up" defaultValue={v("next_follow_up")} /></Field>
        </>
      ) : null}
      <Field label="Est. value (₹)" name="est_value" error={err("est_value")}><Input name="est_value" inputMode="decimal" defaultValue={v("est_value")} /></Field>
      <Field label="Quote amount (₹)" name="quote_amount" error={err("quote_amount")}><Input name="quote_amount" inputMode="decimal" defaultValue={v("quote_amount")} /></Field>
      <Field label="Order value (₹)" name="order_value" error={err("order_value")}><Input name="order_value" inputMode="decimal" defaultValue={v("order_value")} /></Field>
      <Field label="Shipment weight (kg)" name="shipment_weight" error={err("shipment_weight")}><Input name="shipment_weight" inputMode="decimal" defaultValue={v("shipment_weight")} /></Field>
      {team ? (
        <Field label="Lead By (admin)" name="owner_id" hint="Reps hand over with Transfer instead">
          <Select name="owner_id" options={team.map((t) => ({ value: t.id, label: t.name }))} defaultValue={v("owner_id")} placeholder="Unassigned" />
        </Field>
      ) : null}
      <p className="text-xs text-muted sm:col-span-2">Contact changes also update the customer record and this customer’s other enquiries.</p>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
