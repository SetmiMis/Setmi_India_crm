"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth";
import { callRpc } from "@/server/rpc";
import { serviceClient, userClient } from "@/lib/supabase/server";
import { createOrder, getOrder, orderAction, listProducts, OmsError } from "@/integrations/oms";
import { invalid, logServerError, type ActionResult } from "@/lib/errors";

type Prev = ActionResult<unknown> | null;

const itemsSchema = z
  .array(z.object({ productId: z.string().min(1).max(80), qty: z.coerce.number().positive().max(1e7), remarks: z.string().max(300).optional() }))
  .min(1, "Add at least one product and quantity")
  .max(50);

/**
 * Record an order in the OMS (legacy recordOrderToOms). Two-phase so a double click or a retry
 * after a timeout never creates two OMS orders:
 *   1. oms_begin_order (as the user): authorizes ownership and reserves the slot,
 *   2. call the OMS with an Idempotency-Key,
 *   3. oms_complete_order (server role): stores the order id and marks the enquiry Won.
 */
export async function recordOmsOrder(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  const id = z.uuid().safeParse(fd.get("id"));
  const key = z.uuid().safeParse(fd.get("request_key"));
  let items: unknown;
  try {
    items = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    items = [];
  }
  const parsedItems = itemsSchema.safeParse(items);
  if (!id.success || !key.success) return invalid("Missing enquiry");
  if (!parsedItems.success) return invalid(parsedItems.error.issues[0].message, { items: parsedItems.error.issues[0].message });

  const begin = await callRpc<{ status: string; oms_order_id?: string; enquiry?: Record<string, string> }>("oms_begin_order", {
    p_enquiry_id: id.data,
    p_request_key: key.data,
  });
  if (!begin.ok) return begin;
  if (begin.data.status === "succeeded") return { ok: true, message: `Order already recorded: ${begin.data.oms_order_id}` };
  const e = begin.data.enquiry!;

  const svc = serviceClient();
  try {
    const orderId = await createOrder(
      {
        enqId: e.code,
        customer: { company: e.company || e.customer_name, contact: e.customer_name, phone: e.phone, whatsapp: e.phone, email: e.email, gst: e.gst },
        items: parsedItems.data,
        note: String(fd.get("note") ?? "").slice(0, 1000),
        quoteNo: e.quote_no,
      },
      key.data,
    );
    const { error } = await svc.rpc("oms_complete_order", {
      p_request_key: key.data, p_ok: true, p_oms_order_id: orderId, p_error: "", p_payload: { items: parsedItems.data },
    });
    if (error) {
      logServerError("oms-complete", error);
      return { ok: false, code: "internal", message: `OMS created order ${orderId} but saving it failed. Do not retry — tell an admin.` };
    }
    refresh();
    return { ok: true, message: `Order recorded: ${orderId}. Enquiry marked Won.` };
  } catch (err) {
    const msg = err instanceof OmsError ? err.message : "Could not reach the OMS.";
    // A timeout is ambiguous (the OMS may have created the order) — keep the slot "started" so
    // a blind retry with a new key is blocked for 2 minutes; other failures free it.
    if (!(err instanceof OmsError && err.kind === "timeout")) {
      await svc.rpc("oms_complete_order", { p_request_key: key.data, p_ok: false, p_oms_order_id: null, p_error: msg, p_payload: {} });
    }
    logServerError("oms", err);
    return { ok: false, code: "unavailable", message: msg };
  }
}

async function orderIdFor(enquiryId: string): Promise<{ orderId: string | null; error?: ActionResult }> {
  const supabase = await userClient();
  // RLS: a rep can only read their own enquiry, so this doubles as the authorization check.
  const { data } = await supabase.from("enquiries").select("oms_order_id, owner_id").eq("id", enquiryId).maybeSingle();
  if (!data) return { orderId: null, error: { ok: false, code: "not_found", message: "Enquiry not found" } };
  return { orderId: data.oms_order_id };
}

export async function getOmsStatus(enquiryId: string) {
  const ok = z.uuid().safeParse(enquiryId);
  if (!ok.success) return { linked: false as const };
  const { orderId } = await orderIdFor(ok.data);
  if (!orderId) return { linked: false as const };
  try {
    const r = await getOrder(orderId);
    return { linked: true as const, orderId, status: String(r.status ?? ""), piUrl: typeof r.piUrl === "string" && r.piUrl.startsWith("https://") ? r.piUrl : null, raw: r };
  } catch (err) {
    return { linked: true as const, orderId, error: err instanceof OmsError ? err.message : "OMS unavailable" };
  }
}

export async function omsAction(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing enquiry");
  const { orderId, error } = await orderIdFor(id.data);
  if (error) return error;
  if (!orderId) return invalid("No OMS order is recorded for this enquiry.");
  const kind = fd.get("kind");
  try {
    if (kind === "piSent") {
      await orderAction(orderId, { action: "piSent", by: user.fullName });
      return { ok: true, message: "Marked PI as sent." };
    }
    const amount = z.coerce.number().positive().max(1e10).safeParse(fd.get("amount"));
    if (!amount.success) return invalid("Enter the amount received", { amount: "Enter an amount" });
    const proof = String(fd.get("proofUrl") ?? "");
    if (proof && !/^https:\/\//.test(proof)) return invalid("Proof link must start with https://", { proofUrl: "https:// link" });
    await orderAction(orderId, {
      action: "payment", amount: amount.data, ref: String(fd.get("ref") ?? "").slice(0, 100),
      note: String(fd.get("note") ?? "").slice(0, 500), proofUrl: proof, by: user.fullName,
    });
    return { ok: true, message: "Payment recorded in OMS." };
  } catch (err) {
    return { ok: false, code: "unavailable", message: err instanceof OmsError ? err.message : "OMS unavailable" };
  }
}

export async function fetchOmsProducts() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Please sign in again." };
  try {
    return { ok: true as const, products: await listProducts() };
  } catch (err) {
    return { ok: false as const, message: err instanceof OmsError ? err.message : "OMS unavailable" };
  }
}
