"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/server/rpc";
import { fieldErrors, pendingEnquirySchema } from "@/lib/domain/validation";
import { invalid, type ActionResult } from "@/lib/errors";

type Prev = ActionResult<unknown> | null;
const uuid = z.uuid();

export async function approvePending(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing record");
  const ownerRaw = String(fd.get("owner_id") ?? "");
  const owner = ownerRaw ? uuid.safeParse(ownerRaw) : null;
  if (owner && !owner.success) return invalid("Pick a valid team member");
  const r = await callRpc<{ code: string; already_approved: boolean }>("approve_pending", {
    p_id: id.data,
    p_owner: owner?.success ? owner.data : null,
  });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: r.data.already_approved ? `Already approved as ${r.data.code}.` : `Approved as ${r.data.code}.` };
}

export async function rejectPending(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(fd.get("id"));
  const reason = z.string().trim().min(2, "Give a reason").max(500).safeParse(fd.get("reason"));
  if (!id.success) return invalid("Missing record");
  if (!reason.success) return invalid("A rejection reason is required", { reason: "Give a reason" });
  const r = await callRpc("reject_pending", { p_id: id.data, p_reason: reason.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Rejected." };
}

export async function updatePending(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return invalid("Missing record");
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = pendingEnquirySchema.safeParse(raw);
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const p = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v ?? ""]));
  const r = await callRpc("update_pending_enquiry", { p_id: id.data, p });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Pending lead updated." };
}
