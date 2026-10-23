"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/server/rpc";
import { getCurrentUser } from "@/server/auth";
import { callLogSchema, enquiryEditSchema, fieldErrors, pendingEnquirySchema, stageMoveSchema } from "@/lib/domain/validation";
import { invalid, type ActionResult } from "@/lib/errors";
import { serviceClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/errors";
import { fillLocationFromPincode } from "@/server/pincode";

type Prev = ActionResult<unknown> | null;
const uuid = z.uuid();
const entries = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

function idFrom(fd: FormData, key = "id"): string | null {
  const r = uuid.safeParse(fd.get(key));
  return r.success ? r.data : null;
}

/** Drop empty strings so the database keeps existing values / applies defaults. */
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? "" : v]));
}

// ---------- New Enquiry → Pending Approvals (with optional PDF) ----------

const MAX_PDF = 10 * 1024 * 1024;

export async function createPendingEnquiry(_prev: Prev, fd: FormData): Promise<ActionResult<{ code: string; possible_duplicate: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  const parsed = pendingEnquirySchema.safeParse(entries(fd));
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const located = await fillLocationFromPincode(parsed.data);

  let attachment_path = "";
  const file = fd.get("document");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PDF) return invalid("PDF is too large — max 10 MB", { document: "Max 10 MB" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Check the real file signature, not just the declared type.
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!isPdf || file.type !== "application/pdf") return invalid("Only PDF files are accepted", { document: "PDF only" });
    attachment_path = `pending/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.pdf`;
    const { error } = await serviceClient().storage.from("enquiry-documents").upload(attachment_path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) {
      logServerError("upload", error);
      return { ok: false, code: "unavailable", message: "Could not store the PDF. Try again or submit without it." };
    }
  }

  const r = await callRpc<{ code: string; possible_duplicate: boolean }>("create_pending_enquiry", {
    p: { ...compact(located), attachment_path },
  });
  if (!r.ok) return r;
  refresh();
  return {
    ok: true,
    data: r.data,
    message: `Saved to Pending Approvals as ${r.data.code}.${r.data.possible_duplicate ? " Note: this phone already has an enquiry." : ""}`,
  };
}

// ---------- Edit / stage / calls ----------

export async function updateEnquiry(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const raw = entries(fd);
  const parsed = enquiryEditSchema.safeParse(raw);
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const { version, owner_id, ...rest } = parsed.data;
  const p: Record<string, unknown> = compact(rest);
  // Only send owner_id when the admin-only field was present on the form.
  if (fd.has("owner_id")) p.owner_id = owner_id ?? "";
  const r = await callRpc<number>("update_enquiry", { p_id: id, p, p_expected_version: version });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Enquiry updated." };
}

export async function moveStage(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const parsed = stageMoveSchema.safeParse(entries(fd));
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const { stage, version, ...rest } = parsed.data;
  const r = await callRpc<number>("move_stage", { p_id: id, p_stage: stage, p: compact(rest), p_expected_version: version });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: `Moved to ${stage}.` };
}

export async function logCall(_prev: Prev, fd: FormData): Promise<ActionResult<{ call_number: number; over_soft_limit: boolean }>> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const parsed = callLogSchema.safeParse(entries(fd));
  if (!parsed.success) return invalid("Please fix the highlighted fields", fieldErrors(parsed.error));
  const r = await callRpc<{ call_number: number; over_soft_limit: boolean; duplicate: boolean }>("log_call", {
    p_enquiry_id: id,
    p: compact(parsed.data),
  });
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: r.data, message: r.data.duplicate ? "Already logged." : `Call ${r.data.call_number} logged.` };
}

export async function addNote(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  const note = z.string().trim().min(1, "Write a note").max(2000).safeParse(fd.get("note"));
  if (!id) return invalid("Missing enquiry");
  if (!note.success) return invalid("Write a note", { note: "Write a note" });
  const r = await callRpc("add_note", { p_enquiry_id: id, p_note: note.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Note added." };
}

// ---------- Ownership ----------

export async function claimEnquiry(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  const pr = z.enum(["Hot", "Warm", "Cold"]).safeParse(fd.get("priority"));
  if (!id) return invalid("Missing enquiry");
  if (!pr.success) return invalid("Pick a priority after the call", { priority: "Pick a priority" });
  const r = await callRpc<{ code: string }>("claim_enquiry", { p_id: id, p_priority: pr.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: `Claimed — ${r.data.code} is now yours.` };
}

export async function proposeTransfer(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  const to = idFrom(fd, "to_member");
  if (!id || !to) return invalid("Pick who to transfer to", { to_member: "Pick a team member" });
  const r = await callRpc("propose_transfer", { p_id: id, p_to_member: to });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Transfer proposed — waiting for them to accept." };
}

export async function respondTransfer(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd, "transfer_id");
  if (!id) return invalid("Missing transfer");
  const accept = fd.get("accept") === "true";
  const r = await callRpc("respond_transfer", { p_transfer_id: id, p_accept: accept });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: accept ? "Transfer accepted — the lead is yours." : "Transfer declined." };
}

export async function cancelTransfer(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd, "transfer_id");
  if (!id) return invalid("Missing transfer");
  const r = await callRpc("cancel_transfer", { p_transfer_id: id });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Transfer cancelled." };
}

// ---------- Delete / restore / archive ----------

export async function softDeleteEnquiry(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const r = await callRpc("soft_delete_enquiry", { p_id: id, p_reason: String(fd.get("reason") ?? "").slice(0, 300) });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Enquiry deleted (an admin can restore it)." };
}

export async function restoreEnquiry(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const r = await callRpc("restore_enquiry", { p_id: id });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Enquiry restored." };
}

export async function archiveClosed(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const months = z.coerce.number().int().min(1).max(120).safeParse(fd.get("months"));
  if (!months.success) return invalid("Months must be between 1 and 120");
  const r = await callRpc<number>("archive_closed_enquiries", { p_months: months.data });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: `${r.data} enquiry(ies) archived.` };
}

export async function restoreArchived(_prev: Prev, fd: FormData): Promise<ActionResult> {
  const id = idFrom(fd);
  if (!id) return invalid("Missing enquiry");
  const r = await callRpc("restore_archived_enquiry", { p_id: id });
  if (!r.ok) return r;
  refresh();
  return { ok: true, message: "Restored from archive." };
}
