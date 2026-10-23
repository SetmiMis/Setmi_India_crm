// Legacy Google Sheets ("E2O FMS") → PostgreSQL transform. Pure function: no I/O, fully tested.
// Input = header-keyed rows from each sheet's CSV export. Output = rows ready for insert, plus a
// report that accounts for EVERY source row (imported, normalised, renamed, or rejected with a reason).
// Mapping reference: docs/DATA_MIGRATION.md.

export type Row = Record<string, string>;
export type SheetInput = {
  enquiries: Row[];
  archive?: Row[];
  pending: Row[];
  customers: Row[];
  followups: Row[];
  calllog: Row[];
  team: Row[];
  users: Row[];
};

const STAGES = ["New", "Quoted", "Follow-up", "Won", "Lost", "Dispatched", "Closed"];
const OPEN = ["New", "Quoted", "Follow-up"];
const PRIORITIES = ["Hot", "Warm", "Cold"];
const TIMELINES = ["Immediate", "Fortnight", "Just Exploring"];
const ESCALATIONS = ["Proprietor", "Shop Floor"];
const CALL_STATUSES = ["Connected", "Not Connected", "Busy", "Switched Off", "No Answer"];
const INTEREST = ["Interested", "Maybe / Thinking", "Not Interested"];
export const KNOWN_SOURCES = ["IndiaMART", "Phone", "TradeIndia", "Exhibition", "WhatsApp", "Referral", "Walk-in", "Website", "Meta Ads", "Other"];

export type EntityReport = {
  source_rows: number;
  valid: number;
  rejected: number;
  duplicates: number;
  missing_required: number;
  mapping_fixes: number;
  notes: string[];
};
export type MigrationReport = Record<string, EntityReport> & { _issues?: never };
export type Issue = { entity: string; row: number; id: string; kind: "rejected" | "duplicate" | "fixed"; detail: string };

const g = (r: Row, k: string) => String(r[k] ?? "").trim();
const phoneKey = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};
function num(v: string): number | null {
  const s = v.replace(/[^0-9.\-]/g, "");
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
/** Accepts yyyy-mm-dd, yyyy-mm-dd hh:mm(:ss), dd/mm/yyyy, dd-mm-yyyy, "23 Oct 2026", ISO timestamps. Returns yyyy-mm-dd or null. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return valid(m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0"));
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(m[3], MONTHS[m[2].toLowerCase()], m[1].padStart(2, "0"));
  return null;
}
function valid(y: string, mo: string, d: string): string | null {
  const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d) ? null : `${y}-${mo}-${d}`;
}
/** Timestamp: keep the instant if parseable, else midnight IST of the parsed date, else null. */
export function parseTimestamp(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}+05:30`;
  const d = parseDate(s);
  return d ? `${d}T00:00:00+05:30` : null;
}
const codeNum = (code: string, prefix: string) => (code.startsWith(prefix) ? Number(code.slice(prefix.length).replace(/\D/g, "")) || 0 : 0);

function emptyReport(n: number): EntityReport {
  return { source_rows: n, valid: 0, rejected: 0, duplicates: 0, missing_required: 0, mapping_fixes: 0, notes: [] };
}

export function transform(input: SheetInput) {
  const issues: Issue[] = [];
  const report: Record<string, EntityReport> = {};
  const add = (entity: string, row: number, id: string, kind: Issue["kind"], detail: string) => issues.push({ entity, row, id, kind, detail });

  // ---------- Team roster (+ owner/caller names found only in data) ----------
  report.team = emptyReport(input.team.length);
  const team = new Map<string, { name: string; active: boolean }>();
  input.team.forEach((r, i) => {
    const name = g(r, "Name");
    if (!name) { report.team.rejected++; add("team", i + 2, "", "rejected", "blank name"); return; }
    const k = name.toLowerCase();
    if (team.has(k)) { report.team.duplicates++; add("team", i + 2, name, "duplicate", "name repeated"); return; }
    team.set(k, { name, active: g(r, "Active").toUpperCase() !== "NO" });
    report.team.valid++;
  });
  const ensureMember = (name: string) => {
    const n = name.trim();
    if (!n || n === "—") return null;
    const k = n.toLowerCase();
    if (!team.has(k)) {
      team.set(k, { name: n, active: false });
      report.team.mapping_fixes++;
      report.team.notes.push(`added inactive roster name found in data: ${n}`);
    }
    return team.get(k)!.name;
  };

  // ---------- Users: never migrate password hashes (legacy salted SHA-256 ≠ Supabase bcrypt) ----------
  report.users = emptyReport(input.users.length);
  const users = input.users
    .map((r, i) => {
      const username = g(r, "Username").toLowerCase();
      const name = g(r, "Name");
      if (!/^[a-z0-9._-]{3,40}$/.test(username) || !name) {
        report.users.rejected++;
        add("users", i + 2, username, "rejected", "invalid username or blank name");
        return null;
      }
      report.users.valid++;
      ensureMember(name);
      return { username, full_name: name, role: g(r, "Role") === "admin" ? "admin" : "rep", active: g(r, "Active").toUpperCase() !== "NO" };
    })
    .filter(Boolean) as Array<{ username: string; full_name: string; role: string; active: boolean }>;
  report.users.notes.push("Logins must be re-created in the new app (password hashes are not portable). See users_to_create.csv.");

  // ---------- Customers ----------
  report.customers = emptyReport(input.customers.length);
  const customers: Array<Record<string, unknown>> = [];
  const custByCode = new Set<string>();
  const custByPhone = new Map<string, string>();
  input.customers.forEach((r, i) => {
    const code = g(r, "CustID");
    if (!code) { report.customers.missing_required++; report.customers.rejected++; add("customers", i + 2, "", "rejected", "blank CustID"); return; }
    if (custByCode.has(code)) { report.customers.duplicates++; add("customers", i + 2, code, "duplicate", "CustID repeated — later row skipped"); return; }
    const pk = phoneKey(g(r, "Phone"));
    let active = g(r, "Active").toUpperCase() !== "NO";
    if (active && pk && custByPhone.has(pk)) {
      active = false;
      report.customers.duplicates++;
      add("customers", i + 2, code, "duplicate", `same phone as ${custByPhone.get(pk)} — imported as inactive`);
    }
    if (active && pk) custByPhone.set(pk, code);
    custByCode.add(code);
    customers.push({
      cust_code: code, created_at: parseTimestamp(g(r, "CreatedAt")), name: g(r, "Name"), company: g(r, "Company"), phone: g(r, "Phone"),
      email: g(r, "Email"), gst: g(r, "GST").toUpperCase(), pincode: g(r, "Pincode"), district: g(r, "District"), state: g(r, "State"),
      city: g(r, "City"), source: g(r, "Source"), notes: g(r, "Notes"), active,
    });
    report.customers.valid++;
  });

  // ---------- Enquiries (+ Archive sheet, header-driven so BUG-002 positional shifts cannot apply) ----------
  const allEnq = [...input.enquiries.map((r, i) => ({ r, i, archived: false })), ...(input.archive ?? []).map((r, i) => ({ r, i, archived: true }))];
  report.enquiries = emptyReport(allEnq.length);
  const enquiries: Array<Record<string, unknown>> = [];
  const enqCodes = new Set<string>();
  const metaRefs: Array<{ external_id: string; enq_code: string }> = [];
  for (const { r, i, archived } of allEnq) {
    const row = i + 2;
    const code = g(r, "EnqID");
    const sheet = archived ? "archive" : "enquiries";
    if (!code) {
      const blank = Object.values(r).every((v) => !String(v).trim());
      report.enquiries.rejected++;
      if (!blank) report.enquiries.missing_required++;
      add(sheet, row, "", "rejected", blank ? "blank row" : "missing EnqID");
      continue;
    }
    if (enqCodes.has(code)) { report.enquiries.duplicates++; add(sheet, row, code, "duplicate", "EnqID repeated — later row skipped"); continue; }
    const customer = g(r, "Customer") || g(r, "Company");
    if (!customer) { report.enquiries.missing_required++; report.enquiries.rejected++; add(sheet, row, code, "rejected", "no customer name"); continue; }
    let stage = g(r, "Stage");
    if (!STAGES.includes(stage)) {
      const fixed = STAGES.find((s) => s.toLowerCase() === stage.toLowerCase().replace(/\s+/g, "-")) ?? STAGES.find((s) => s.toLowerCase() === stage.toLowerCase());
      if (fixed) { report.enquiries.mapping_fixes++; add(sheet, row, code, "fixed", `stage "${stage}" → ${fixed}`); stage = fixed; }
      else { report.enquiries.rejected++; add(sheet, row, code, "rejected", `unknown stage "${stage}"`); continue; }
    }
    let source = g(r, "Source");
    if (!KNOWN_SOURCES.includes(source)) {
      if (source) { report.enquiries.mapping_fixes++; add(sheet, row, code, "fixed", `source "${source}" → Other`); }
      source = "Other";
    }
    let priority: string | null = PRIORITIES.includes(g(r, "Priority")) ? g(r, "Priority") : null;
    let next = parseDate(g(r, "NextFollowUp"));
    if (!OPEN.includes(stage) && (priority || next)) {
      priority = null; next = null;
      report.enquiries.mapping_fixes++;
      add(sheet, row, code, "fixed", "cleared priority/next follow-up on a closed-out stage");
    }
    const owner = ensureMember(g(r, "LeadBy") || g(r, "Owner"));
    const enqDate = parseDate(g(r, "EnqDate")) ?? parseDate(g(r, "CreatedAt"));
    if (!enqDate) { report.enquiries.mapping_fixes++; add(sheet, row, code, "fixed", "no valid EnqDate — used migration date"); }
    const notes = g(r, "Notes");
    const meta = notes.match(/MetaLeadID:(\S+)/);
    if (meta) metaRefs.push({ external_id: meta[1], enq_code: code });
    const rating = num(g(r, "FeedbackRating"));
    const qty = num(g(r, "Qty"));
    const timeline = TIMELINES.includes(g(r, "Timeline")) ? g(r, "Timeline") : null;
    enqCodes.add(code);
    enquiries.push({
      enq_code: code, created_at: parseTimestamp(g(r, "CreatedAt")), enq_date: enqDate, customer_name: customer, company: g(r, "Company"),
      phone: g(r, "Phone"), email: g(r, "Email"), gst: g(r, "GST").toUpperCase(), pincode: g(r, "Pincode"), district: g(r, "District"),
      state: g(r, "State"), city: g(r, "City"), source, requirement: g(r, "Requirement"), est_value: num(g(r, "EstValue")), stage, priority,
      owner_name: owner, claimed_at: parseTimestamp(g(r, "ClaimedAt")), quote_no: g(r, "QuoteNo"), quote_amount: num(g(r, "QuoteAmount")),
      quote_date: parseDate(g(r, "QuoteDate")), next_follow_up: next, last_contact: parseDate(g(r, "LastContact")), order_value: num(g(r, "OrderValue")),
      lost_reason: g(r, "LostReason"), dispatch_date: parseDate(g(r, "DispatchDate")), dispatch_info: g(r, "DispatchInfo"),
      shipment_weight: num(g(r, "ShipmentWeight")), feedback_rating: rating && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
      feedback_note: g(r, "FeedbackNote"), notes, active: g(r, "Active").toUpperCase() !== "NO", archived,
      legacy_photo_url: g(r, "PhotoUrl"), qty, timeline,
      escalation: ESCALATIONS.includes(g(r, "Escalation")) ? g(r, "Escalation") : null, invoice_no: g(r, "InvoiceNo"),
      oms_order_id: g(r, "OMSOrderID") || null, transfer_to_name: g(r, "TransferTo") || null,
    });
    report.enquiries.valid++;
  }
  // Every enquiry phone gets a customer record (legacy backfillCustomers_).
  for (const e of enquiries) {
    const pk = phoneKey(String(e.phone));
    if (pk && !custByPhone.has(pk)) {
      const code = `CUST-M${String(customers.length + 1).padStart(5, "0")}`;
      customers.push({ cust_code: code, created_at: e.created_at, name: e.customer_name, company: e.company, phone: e.phone, email: e.email,
        gst: e.gst, pincode: e.pincode, district: e.district, state: e.state, city: e.city, source: e.source, notes: "created by migration", active: true });
      custByPhone.set(pk, code);
      report.customers.mapping_fixes++;
    }
    e.customer_code = pk ? custByPhone.get(pk) ?? null : null;
  }
  if (report.customers.mapping_fixes) report.customers.notes.push(`${report.customers.mapping_fixes} customer record(s) created from enquiry phones`);

  // ---------- Pending approvals ----------
  report.pending = emptyReport(input.pending.length);
  const pending: Array<Record<string, unknown>> = [];
  const pendCodes = new Set<string>();
  input.pending.forEach((r, i) => {
    const code = g(r, "PendingID");
    if (!code) { report.pending.rejected++; add("pending", i + 2, "", "rejected", "blank PendingID"); return; }
    if (pendCodes.has(code)) { report.pending.duplicates++; add("pending", i + 2, code, "duplicate", "PendingID repeated"); return; }
    const name = g(r, "Customer");
    let phone = g(r, "Phone").replace(/^=/, "");
    if (/#ERROR|#N\/A|#VALUE/i.test(phone)) { phone = ""; report.pending.mapping_fixes++; add("pending", i + 2, code, "fixed", "phone was a broken spreadsheet formula (BUG-016) — cleared"); }
    if (!name && !phone) { report.pending.missing_required++; report.pending.rejected++; add("pending", i + 2, code, "rejected", "no name or phone"); return; }
    let status = g(r, "Status") || "Pending";
    if (!["Pending", "Approved", "Rejected"].includes(status)) { report.pending.rejected++; add("pending", i + 2, code, "rejected", `unknown status ${status}`); return; }
    const approved = g(r, "ApprovedEnqID");
    if (status === "Approved" && !enqCodes.has(approved)) {
      status = "Pending";
      report.pending.mapping_fixes++;
      add("pending", i + 2, code, "fixed", `approved enquiry ${approved || "(blank)"} not found — re-queued as Pending`);
    }
    let reason = g(r, "RejectReason");
    if (status === "Rejected" && !reason) { reason = "(not recorded in legacy sheet)"; report.pending.mapping_fixes++; }
    const reviewedAt = parseTimestamp(g(r, "ReviewedAt")) ?? (status === "Pending" ? null : parseTimestamp(g(r, "CreatedAt")) ?? new Date().toISOString());
    const submittedBy = g(r, "SubmittedBy");
    pendCodes.add(code);
    pending.push({
      pend_code: code, created_at: parseTimestamp(g(r, "CreatedAt")), submitted_via: /meta/i.test(submittedBy) ? "meta_import" : "legacy",
      submitted_by_label: submittedBy, customer_name: name || "(no name)", company: g(r, "Company"), phone, email: g(r, "Email"),
      gst: g(r, "GST").toUpperCase(), pincode: g(r, "Pincode"), district: g(r, "District"), state: g(r, "State"), city: g(r, "City"),
      source: KNOWN_SOURCES.includes(g(r, "Source")) ? g(r, "Source") : "Other",
      priority: PRIORITIES.includes(g(r, "Priority")) ? g(r, "Priority") : null, owner_name: ensureMember(g(r, "LeadBy")),
      est_value: num(g(r, "EstValue")), requirement: g(r, "Requirement"), qty: num(g(r, "Qty")),
      timeline: TIMELINES.includes(g(r, "Timeline")) ? g(r, "Timeline") : null, notes: g(r, "Notes"), legacy_photo_url: g(r, "PhotoUrl"),
      status, approved_enq_code: status === "Approved" ? approved : null, reviewed_by_label: g(r, "ReviewedBy"),
      reviewed_at: reviewedAt, reject_reason: status === "Rejected" ? reason : "",
    });
    report.pending.valid++;
  });

  // ---------- Follow-ups (duplicate IDs renamed — BUG-003) ----------
  report.follow_ups = emptyReport(input.followups.length);
  const followUps: Array<Record<string, unknown>> = [];
  const fuCodes = new Map<string, number>();
  input.followups.forEach((r, i) => {
    let code = g(r, "FollowUpID");
    const enq = g(r, "EnqID");
    if (!code || !enqCodes.has(enq)) {
      report.follow_ups.rejected++;
      if (!code) report.follow_ups.missing_required++;
      add("follow_ups", i + 2, code, "rejected", !code ? "blank FollowUpID" : `orphan: enquiry ${enq || "(blank)"} not imported`);
      return;
    }
    const seen = fuCodes.get(code) ?? 0;
    fuCodes.set(code, seen + 1);
    if (seen > 0) { report.follow_ups.duplicates++; add("follow_ups", i + 2, code, "duplicate", `duplicate id kept as ${code}-D${seen}`); code = `${code}-D${seen}`; }
    followUps.push({
      fu_code: code, created_at: parseTimestamp(g(r, "CreatedAt")), enq_code: enq, customer_name: g(r, "Customer"),
      mode: g(r, "Mode") === "Call" ? "Call" : "Note", outcome: g(r, "Outcome"), next_follow_up: parseDate(g(r, "NextFollowUp")),
      by_name: ensureMember(g(r, "By")), by_label: g(r, "By"), note: g(r, "Note"),
    });
    report.follow_ups.valid++;
  });

  // ---------- Call log (duplicate IDs renamed; call numbers made unique per enquiry) ----------
  report.call_logs = emptyReport(input.calllog.length);
  const calls: Array<Record<string, unknown>> = [];
  const callCodes = new Map<string, number>();
  input.calllog.forEach((r, i) => {
    let code = g(r, "CallLogID");
    const enq = g(r, "EnqID");
    if (!code || !enqCodes.has(enq)) {
      report.call_logs.rejected++;
      if (!code) report.call_logs.missing_required++;
      add("call_logs", i + 2, code, "rejected", !code ? "blank CallLogID" : `orphan: enquiry ${enq || "(blank)"} not imported`);
      return;
    }
    const seen = callCodes.get(code) ?? 0;
    callCodes.set(code, seen + 1);
    if (seen > 0) { report.call_logs.duplicates++; add("call_logs", i + 2, code, "duplicate", `duplicate id kept as ${code}-D${seen}`); code = `${code}-D${seen}`; }
    const status = CALL_STATUSES.includes(g(r, "CallStatus")) ? g(r, "CallStatus") : "Connected";
    if (status !== g(r, "CallStatus")) { report.call_logs.mapping_fixes++; add("call_logs", i + 2, code, "fixed", `status "${g(r, "CallStatus")}" → Connected (legacy default)`); }
    const date = parseDate(g(r, "CallDate")) ?? parseDate(g(r, "CreatedAt"));
    if (!date) { report.call_logs.rejected++; add("call_logs", i + 2, code, "rejected", "no valid call date"); return; }
    calls.push({
      call_code: code, created_at: parseTimestamp(g(r, "CreatedAt")), enq_code: enq, customer_name: g(r, "Customer"),
      call_number_src: Number(g(r, "CallNumber")) || 0, call_date: date, employee_name: ensureMember(g(r, "Employee")),
      employee_label: g(r, "Employee"), remarks: g(r, "Remarks"), next_follow_up: parseDate(g(r, "NextFollowUp")), call_status: status,
      interest: status === "Connected" && INTEREST.includes(g(r, "Interest")) ? g(r, "Interest") : null,
    });
    report.call_logs.valid++;
  });
  // Renumber 1..n per enquiry in (CallNumber, CreatedAt) order so (enquiry, call_number) is unique.
  const byEnq = new Map<string, Array<Record<string, unknown>>>();
  for (const c of calls) byEnq.set(String(c.enq_code), [...(byEnq.get(String(c.enq_code)) ?? []), c]);
  let renumbered = 0;
  for (const list of byEnq.values()) {
    list.sort((a, b) => Number(a.call_number_src) - Number(b.call_number_src) || String(a.created_at).localeCompare(String(b.created_at)));
    list.forEach((c, idx) => {
      if (c.call_number_src !== idx + 1) renumbered++;
      c.call_number = idx + 1;
    });
  }
  if (renumbered) { report.call_logs.mapping_fixes += renumbered; report.call_logs.notes.push(`${renumbered} call number(s) renumbered to be unique per enquiry`); }

  // Counter high-water marks so new codes continue after the legacy ones.
  const maxOf = (codes: Iterable<string>, prefix: string) => Math.max(0, ...[...codes].map((c) => codeNum(c, prefix)));
  const counters = {
    "SETMI-ENQ-": maxOf(enqCodes, "SETMI-ENQ-"),
    "CUST-": maxOf(custByCode, "CUST-"),
    "PEND-": maxOf(pendCodes, "PEND-"),
    "FU-": maxOf(fuCodes.keys(), "FU-"),
    "CALL-": maxOf(callCodes.keys(), "CALL-"),
  };

  return {
    team: [...team.values()],
    users,
    customers,
    enquiries,
    pending,
    followUps,
    calls,
    metaRefs,
    counters,
    report,
    issues,
  };
}

export type Transformed = ReturnType<typeof transform>;
