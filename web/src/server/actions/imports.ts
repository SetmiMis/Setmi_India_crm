"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { callRpc } from "@/server/rpc";
import { requireAdmin, getCurrentUser } from "@/server/auth";
import { runMetaSheetImport } from "@/server/jobs";
import { sanitizeCell } from "@/lib/domain/imports";
import { invalid, type ActionResult } from "@/lib/errors";

type Prev = ActionResult<unknown> | null;

const cell = (max: number) => z.string().max(2000).transform((v) => sanitizeCell(v, max));

const bulkRow = z.object({
  name: cell(120),
  phone: z.string().max(40).transform((v) => v.replace(/[^\d+]/g, "")),
  company: cell(120),
  requirement: cell(800),
  quantity: cell(60),
  source: cell(40),
  priority: cell(10),
  remark: cell(500),
});

export type ImportSummary = { accepted: number; rejected: number; duplicates: number; errors: Array<{ row: number; error: string }> };

/** Bulk Import (legacy submitBulkPendingFromRows): parsed client-side, validated again here, all rows land in Pending. */
export async function bulkImport(_prev: Prev, fd: FormData): Promise<ActionResult<ImportSummary>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "unauthenticated", message: "Please sign in again." };
  let rows: unknown;
  try {
    rows = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    return invalid("Could not read the file data.");
  }
  const parsed = z.array(bulkRow).min(1, "No rows to import").max(2000, "Max 2000 rows per file").safeParse(rows);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const ownerId = String(fd.get("owner_id") ?? "");
  const withOwner = parsed.data.map((r) => ({ ...r, owner_id: z.uuid().safeParse(ownerId).success ? ownerId : "" }));
  const r = await callRpc<ImportSummary>("bulk_create_pending", {
    p_rows: withOwner,
    p_file_name: String(fd.get("file_name") ?? "upload").slice(0, 200),
  });
  if (!r.ok) return r;
  refresh();
  return {
    ok: true,
    data: r.data,
    message: `Imported ${r.data.accepted} lead(s) into Pending Approvals. ${r.data.rejected} rejected, ${r.data.duplicates} duplicate(s) in file.`,
  };
}

const metaRow = z.object({
  external_id: z.string().trim().min(1).max(200),
  name: cell(120),
  phone: z.string().max(40),
  company: cell(120),
  city: cell(80),
  pincode: z.string().max(12),
  requirement: cell(800),
  qty: z.string().max(30),
  raw: z.record(z.string(), z.string()).optional(),
});

/** Admin uploads a Meta Ads lead export (CSV/XLSX). Dedup by Meta lead id. */
export async function importMetaFile(_prev: Prev, fd: FormData): Promise<ActionResult<{ imported: number; duplicates: number; rejected: number }>> {
  await requireAdmin();
  let rows: unknown;
  try {
    rows = JSON.parse(String(fd.get("rows") ?? "[]"));
  } catch {
    return invalid("Could not read the file data.");
  }
  const parsed = z.array(metaRow).min(1, "No leads found").max(5000).safeParse(rows);
  if (!parsed.success) return invalid(parsed.error.issues[0].message);
  const r = await callRpc<{ imported: number; duplicates: number; rejected: number; target: string }>("import_external_leads", {
    p_source: "meta", p_rows: parsed.data, p_kind: "meta_file", p_file_name: String(fd.get("file_name") ?? "meta").slice(0, 200), p_actor: null,
  });
  if (!r.ok) return r;
  refresh();
  return {
    ok: true,
    data: r.data,
    message: `Meta import: ${r.data.imported} new (→ ${r.data.target === "pending" ? "Pending Approvals" : "Available Leads"}), ${r.data.duplicates} already imported, ${r.data.rejected} rejected.`,
  };
}

export async function importMetaSheetNow(): Promise<ActionResult> {
  const admin = await requireAdmin();
  const r = await runMetaSheetImport(admin.id);
  refresh();
  if (r.status === "ok") return { ok: true, message: `Imported ${r.imported} new lead(s); ${r.duplicates} already imported.` };
  return { ok: false, code: "unavailable", message: r.detail ?? `Import ${r.status}` };
}
