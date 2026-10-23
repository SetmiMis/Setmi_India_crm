"use client";

import { useMemo, useState, useTransition } from "react";
import { createPendingEnquiry } from "@/server/actions/enquiries";
import { lookupCustomerByPhone } from "@/server/actions/customers";
import { lookupPincode } from "@/server/actions/lookup";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { PRIORITIES, TIMELINES, gradeFor } from "@/lib/domain/constants";
import { niceDate } from "@/lib/domain/dates";

type Team = Array<{ id: string; name: string }>;
const EMPTY = { customer_name: "", company: "", email: "", gst: "", pincode: "", district: "", state: "", city: "" };

export function NewEnquiryForm({ sources, team, myMemberId }: { sources: string[]; team: Team; myMemberId: string | null }) {
  const { state, formAction, pending, err, formRef } = useFormAction(createPendingEnquiry, { resetOnSuccess: true });
  const [f, setF] = useState(EMPTY);
  const [areas, setAreas] = useState<string[]>([]);
  const [dup, setDup] = useState<string | null>(null);
  const [known, setKnown] = useState(false);
  const [qty, setQty] = useState("");
  const [timeline, setTimeline] = useState("");
  const [, start] = useTransition();
  const grade = useMemo(() => gradeFor(Number(qty) || null, timeline), [qty, timeline]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const onPhoneBlur = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return;
    start(async () => {
      const r = await lookupCustomerByPhone(phone);
      const c = r.customer as Record<string, string | boolean>;
      if (c.found) {
        setKnown(true);
        setF((cur) => ({
          customer_name: cur.customer_name || String(c.name ?? ""), company: cur.company || String(c.company ?? ""),
          email: cur.email || String(c.email ?? ""), gst: cur.gst || String(c.gst ?? ""), pincode: cur.pincode || String(c.pincode ?? ""),
          district: cur.district || String(c.district ?? ""), state: cur.state || String(c.state ?? ""), city: cur.city || String(c.city ?? ""),
        }));
      } else setKnown(false);
      const d = r.duplicate;
      setDup(d.found ? `This phone already has ${d.count} enquiry(ies) — last on ${niceDate(d.last_date)} (${d.last_stage}).` : null);
    });
  };

  const onPinBlur = (pin: string) => {
    if (!/^\d{6}$/.test(pin)) return;
    start(async () => {
      const r = await lookupPincode(pin);
      if (r.found) {
        setAreas(r.areas ?? []);
        setF((cur) => ({ ...cur, district: r.district ?? cur.district, state: r.state ?? cur.state }));
      }
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={submitTo(formAction)}
      onReset={() => {
        setF(EMPTY); setQty(""); setTimeline(""); setDup(null); setKnown(false); setAreas([]);
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-3"
    >
      <Field label="Phone" name="phone" error={err("phone")} required hint={known ? "Known customer — details filled in" : "10-digit mobile"}>
        <Input name="phone" required inputMode="tel" maxLength={20} autoFocus onBlur={(e) => onPhoneBlur(e.target.value)} />
      </Field>
      <Field label="Customer name" name="customer_name" error={err("customer_name")} required>
        <Input name="customer_name" required maxLength={120} value={f.customer_name} onChange={set("customer_name")} />
      </Field>
      <Field label="Company" name="company"><Input name="company" maxLength={120} value={f.company} onChange={set("company")} /></Field>
      {dup ? <div className="md:col-span-3"><Notice tone="warn">{dup}</Notice></div> : null}
      <Field label="Email" name="email" error={err("email")}><Input name="email" type="email" maxLength={120} value={f.email} onChange={set("email")} /></Field>
      <Field label="GSTIN" name="gst" error={err("gst")}><Input name="gst" maxLength={15} value={f.gst} onChange={set("gst")} /></Field>
      <Field label="Pincode" name="pincode" error={err("pincode")} hint="Fills district and state">
        <Input name="pincode" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set("pincode")} onBlur={(e) => onPinBlur(e.target.value)} />
      </Field>
      <Field label="City / area" name="city">
        <Input name="city" maxLength={80} value={f.city} onChange={set("city")} list="pin-areas" />
        <datalist id="pin-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
      </Field>
      <Field label="District" name="district"><Input name="district" maxLength={80} value={f.district} onChange={set("district")} /></Field>
      <Field label="State" name="state"><Input name="state" maxLength={80} value={f.state} onChange={set("state")} /></Field>
      <Field label="Source" name="source"><Select name="source" options={sources} defaultValue="Other" /></Field>
      <Field label="Priority" name="priority"><Select name="priority" options={PRIORITIES} defaultValue="Warm" /></Field>
      <Field label="Lead By" name="owner_id" hint="Leave empty to put it on Available Leads after approval">
        <Select name="owner_id" options={team.map((t) => ({ value: t.id, label: t.name }))} placeholder="Unassigned (Available Leads)" defaultValue={myMemberId ?? ""} />
      </Field>
      <Field label="Requirement" name="requirement" className="md:col-span-3"><Textarea name="requirement" maxLength={1000} placeholder="Product, size, specs…" /></Field>
      <Field label="Qty (metres/units)" name="qty" error={err("qty")}><Input name="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field label="Buyer timeline" name="timeline" hint={grade ? `Lead grade ${grade}` : "Grade needs Qty + Timeline"}>
        <Select name="timeline" options={TIMELINES} placeholder="—" value={timeline} onChange={(e) => setTimeline(e.target.value)} />
      </Field>
      <Field label="Est. value (₹)" name="est_value" error={err("est_value")}><Input name="est_value" inputMode="decimal" /></Field>
      <Field label="Notes" name="notes" className="md:col-span-2"><Textarea name="notes" maxLength={4000} /></Field>
      <Field label="Document (PDF, max 10 MB)" name="document" error={err("document")}>
        <Input name="document" type="file" accept="application/pdf" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for approval"}</Button>
        <Button type="reset" variant="ghost">Clear</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
