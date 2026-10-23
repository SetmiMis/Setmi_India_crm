"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/server/rpc";
import { customerSchema, fieldErrors } from "@/lib/domain/validation";
import { invalid, type ActionResult } from "@/lib/errors";

type Prev = ActionResult<unknown> | null;
const strings = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

export async function createCustomer(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const parsed = customerSchema.safeParse(strings(fd));
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const r = await callRpc("create_customer", { p: parsed.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Customer saved." };
}

export async function updateCustomer(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing customer");
  const parsed = customerSchema.safeParse(strings(fd));
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const r = await callRpc("update_customer", { p_id: id.data, p: parsed.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Customer updated — linked enquiries were updated too." };
}

/** Known-customer autofill for New Enquiry (any signed-in user, like the legacy app). */
export async function lookupCustomerByPhone(phone: string) {
  const r = await callRpc<Record<string, string | boolean>>("customer_by_phone", { p_phone: String(phone).slice(0, 20) });
  const dup = await callRpc<{ found: boolean; count?: number; last_date?: string; last_stage?: string }>("check_phone_duplicate", {
    p_phone: String(phone).slice(0, 20),
  });
  return { customer: r.ok ? r.data : { found: false }, duplicate: dup.ok ? dup.data : { found: false } };
}
