"use client";

import { createCustomer, updateCustomer } from "@/server/actions/customers";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

type C = { id: string; name: string; company: string; phone: string; email: string; gst: string; pincode: string; district: string; state: string; city: string; notes: string };

export function CustomerForm({ customer }: { customer?: C }) {
  const { state, formAction, pending, err, formRef } = useFormAction(customer ? updateCustomer : createCustomer, { resetOnSuccess: !customer });
  const v = (k: keyof C) => customer?.[k] ?? "";
  return (
    <form ref={formRef} onSubmit={submitTo(formAction)} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}
      <Field label="Name" name="name" error={err("name")} required><Input name="name" defaultValue={v("name")} required maxLength={120} /></Field>
      <Field label="Company" name="company"><Input name="company" defaultValue={v("company")} maxLength={120} /></Field>
      <Field label="Phone" name="phone" error={err("phone")} required><Input name="phone" defaultValue={v("phone")} required inputMode="tel" maxLength={20} /></Field>
      <Field label="Email" name="email" error={err("email")}><Input name="email" type="email" defaultValue={v("email")} maxLength={120} /></Field>
      <Field label="GSTIN" name="gst" error={err("gst")}><Input name="gst" defaultValue={v("gst")} maxLength={15} /></Field>
      <Field label="Pincode" name="pincode" error={err("pincode")}><Input name="pincode" defaultValue={v("pincode")} maxLength={6} inputMode="numeric" /></Field>
      <Field label="City" name="city"><Input name="city" defaultValue={v("city")} maxLength={80} /></Field>
      <Field label="District" name="district"><Input name="district" defaultValue={v("district")} maxLength={80} /></Field>
      <Field label="State" name="state"><Input name="state" defaultValue={v("state")} maxLength={80} /></Field>
      <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea name="notes" defaultValue={v("notes")} maxLength={2000} /></Field>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : customer ? "Save customer" : "Add customer"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
