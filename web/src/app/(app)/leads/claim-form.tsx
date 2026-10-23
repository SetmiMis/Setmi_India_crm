"use client";

import { claimEnquiry } from "@/server/actions/enquiries";
import { FormMessage, useFormAction, submitTo } from "@/components/action-form";
import { Button } from "@/components/ui/button";

export function ClaimForm({ id }: { id: string }) {
  const { state, formAction, pending } = useFormAction(claimEnquiry, { redirectTo: `/enquiries/${id}#log-call` });
  return (
    <form onSubmit={submitTo(formAction)} className="flex flex-col items-stretch gap-1.5 md:w-56">
      <input type="hidden" name="id" value={id} />
      <label className="field-label" htmlFor={`pr-${id}`}>Priority after the call</label>
      <div className="flex gap-1.5">
        <select id={`pr-${id}`} name="priority" required defaultValue="" className="input">
          <option value="" disabled>Choose…</option>
          <option>Hot</option>
          <option>Warm</option>
          <option>Cold</option>
        </select>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "…" : "Claim"}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
