import "server-only";
import { serviceClient } from "@/lib/supabase/server";
import { env, isConfigured } from "@/lib/env";
import { escapeHtml, sendEmail } from "@/integrations/email";
import { readAllTabs } from "@/integrations/google-sheets";
import { mapMetaRows } from "@/lib/domain/imports";
import { niceDate, todayIST } from "@/lib/domain/dates";
import { COMPANY } from "@/lib/domain/constants";
import { logServerError } from "@/lib/errors";

type DigestRow = { enq_code: string; customer_name: string; company: string; priority: string | null; stage: string; next_follow_up: string; owner_name: string };

/** Daily digest (legacy sendDailyDigest). Idempotent per IST date via job_runs. */
export async function runDailyDigest(): Promise<{ status: string; detail?: string }> {
  const svc = serviceClient();
  const runKey = todayIST();
  const { data: started } = await svc.rpc("job_try_start", { p_job: "daily_digest", p_run_key: runKey });
  if (!started) return { status: "skipped", detail: "already ran today" };
  try {
    const { data, error } = await svc.rpc("digest_data");
    if (error) throw error;
    const d = data as { overdue: DigestRow[]; today: DigestRow[]; pending_approvals: number; new_yesterday: number; recipients: string[] };
    const to = d.recipients.filter((x) => typeof x === "string" && x.includes("@"));
    const base = env().APP_BASE_URL ?? "";
    const row = (e: DigestRow, tag: string) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${escapeHtml(e.customer_name)}</b>${e.company ? ` — ${escapeHtml(e.company)}` : ""}<br><span style="color:#777">${escapeHtml(e.enq_code)} · ${escapeHtml(e.stage)} · ${escapeHtml(e.owner_name)}</span></td><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${tag} ${escapeHtml(niceDate(e.next_follow_up))}</td></tr>`;
    // Phone numbers are deliberately left out of the email (legacy included them — SEC-13).
    let html = `<div style="font-family:Arial,sans-serif;max-width:720px"><h2 style="color:#0b86ac;margin:0">${COMPANY.name} — Aaj ke Follow-ups</h2>`;
    html += `<p style="color:#555">${escapeHtml(niceDate(runKey))} · Overdue: <b style="color:#d9594a">${d.overdue.length}</b> · Due today: <b>${d.today.length}</b> · Pending approvals: <b>${d.pending_approvals}</b> · New yesterday: <b>${d.new_yesterday}</b></p>`;
    if (d.overdue.length) html += `<h3 style="color:#d9594a">⚠ Overdue (${d.overdue.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${d.overdue.slice(0, 100).map((e) => row(e, "Due")).join("")}</table>`;
    if (d.today.length) html += `<h3 style="color:#54a737">● Due Today (${d.today.length})</h3><table style="width:100%;border-collapse:collapse;font-size:13px">${d.today.slice(0, 100).map((e) => row(e, "Today")).join("")}</table>`;
    if (!d.overdue.length && !d.today.length) html += `<p style="color:#54a737">✓ Koi follow-up due nahi hai aaj.</p>`;
    if (base) html += `<p><a href="${escapeHtml(base)}/follow-ups" style="background:#0b86ac;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open SETMI CRM</a></p>`;
    html += `<p style="color:#999;font-size:12px">${COMPANY.tagline}</p></div>`;
    const text = `${COMPANY.name} — overdue ${d.overdue.length}, due today ${d.today.length}, pending approvals ${d.pending_approvals}.`;
    const res = await sendEmail({ to, subject: `[${COMPANY.name}] ${d.overdue.length} overdue · ${d.today.length} due today`, html, text });
    await svc.rpc("job_finish", { p_job: "daily_digest", p_run_key: runKey, p_status: res.sent ? "succeeded" : "skipped", p_details: { recipients: to.length, reason: res.reason ?? null } });
    return { status: res.sent ? "sent" : "skipped", detail: res.reason };
  } catch (err) {
    logServerError("digest", err);
    await svc.rpc("job_finish", { p_job: "daily_digest", p_run_key: runKey, p_status: "failed", p_details: { error: "see server log" } });
    return { status: "failed" };
  }
}

/** Scheduled Meta Ads import from the external Google Sheet (legacy 30-minute trigger). */
export async function runMetaSheetImport(actorId: string | null): Promise<{ status: string; imported?: number; duplicates?: number; detail?: string }> {
  if (!isConfigured("metaSheet")) return { status: "skipped", detail: "Meta sheet / Google service account not configured" };
  const svc = serviceClient();
  const runKey = new Date().toISOString().slice(0, 16); // per minute: blocks overlapping runs
  const { data: started } = await svc.rpc("job_try_start", { p_job: "meta_import", p_run_key: runKey });
  if (!started) return { status: "skipped", detail: "a run is already in progress" };
  try {
    const tabs = await readAllTabs(env().META_SHEET_ID!);
    const leads = tabs.flatMap((t) => mapMetaRows(t.headers, t.rows, t.tab));
    const { data, error } = await svc.rpc("import_external_leads", {
      p_source: "meta", p_rows: leads.slice(0, 5000), p_kind: "meta_sheet", p_file_name: "Meta leads sheet", p_actor: actorId,
    });
    if (error) throw error;
    const r = data as { imported: number; duplicates: number };
    await svc.rpc("job_finish", { p_job: "meta_import", p_run_key: runKey, p_status: "succeeded", p_details: r });
    return { status: "ok", imported: r.imported, duplicates: r.duplicates };
  } catch (err) {
    logServerError("meta-import", err);
    await svc.rpc("job_finish", { p_job: "meta_import", p_run_key: runKey, p_status: "failed", p_details: { error: (err as Error).message?.slice(0, 200) } });
    return { status: "failed", detail: (err as Error).message };
  }
}
