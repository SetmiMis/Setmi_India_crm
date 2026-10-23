"use client";

import { useState, useTransition } from "react";
import { submitPublicEnquiry } from "@/server/actions/public";
import { lookupPincode } from "@/server/actions/lookup";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { TIMELINES } from "@/lib/domain/constants";

export function PublicEnquiryForm() {
  const [token, setToken] = useState(() => crypto.randomUUID());
  const { state, formAction, pending, err, formRef } = useFormAction(submitPublicEnquiry, { resetOnSuccess: true });
  const [loc, setLoc] = useState({ district: "", state: "", city: "" });
  const [, start] = useTransition();

  if (state?.ok) {
    return (
      <div className="space-y-3 text-center">
        <FormMessage state={state} />
        <Button variant="secondary" onClick={() => { setToken(crypto.randomUUID()); window.location.reload(); }}>Send another enquiry</Button>
      </div>
    );
  }
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="form_token" value={token} />
      {/* Honeypot — hidden from people, filled by bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      <Field label="Your name" name="customer_name" error={err("customer_name")} required><Input name="customer_name" required maxLength={120} autoComplete="name" /></Field>
      <Field label="Mobile number" name="phone" error={err("phone")} required><Input name="phone" required inputMode="tel" maxLength={20} autoComplete="tel" /></Field>
      <Field label="Company" name="company"><Input name="company" maxLength={120} autoComplete="organization" /></Field>
      <Field label="Email" name="email" error={err("email")}><Input name="email" type="email" maxLength={120} autoComplete="email" /></Field>
      <Field label="Pincode" name="pincode" error={err("pincode")}>
        <Input name="pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code"
          onBlur={(e) => { const pin = e.target.value; if (/^\d{6}$/.test(pin)) start(async () => { const r = await lookupPincode(pin, true); if (r.found) setLoc((l) => ({ ...l, district: r.district ?? "", state: r.state ?? "" })); }); }} />
      </Field>
      <Field label="City" name="city"><Input name="city" maxLength={80} value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} /></Field>
      <input type="hidden" name="district" value={loc.district} />
      <input type="hidden" name="state" value={loc.state} />
      <Field label="What do you need?" name="requirement" error={err("requirement")} required className="sm:col-span-2">
        <Textarea name="requirement" required minLength={3} maxLength={1000} placeholder="Product, size, quantity…" />
      </Field>
      <Field label="Quantity" name="qty" error={err("qty")}><Input name="qty" inputMode="decimal" /></Field>
      <Field label="When do you need it?" name="timeline"><Select name="timeline" options={TIMELINES} placeholder="—" /></Field>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
        <Button type="submit" className="mt-2 w-full" disabled={pending}>{pending ? "Sending…" : "Send enquiry"}</Button>
      </div>
    </form>
  );
}
