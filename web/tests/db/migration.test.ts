// Legacy Sheets → Postgres migration: transform rules, load, reconciliation and re-run idempotency,
// using synthetic rows shaped like the real sheet headers (docs/03_DATABASE_DICTIONARY.md).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb, type Db } from "./harness";
import { transform, parseDate, type SheetInput } from "../../src/lib/migration/transform";
import { applyMigration, reconcile } from "../../src/lib/migration/apply";

const enq = (id: string, extra: Record<string, string> = {}) => ({
  EnqID: id, CreatedAt: "2026-09-01 10:15:00", EnqDate: "2026-09-01", Customer: `Cust ${id}`, Company: "Acme", Phone: "9876500001",
  Email: "", GST: "", Pincode: "110001", District: "New Delhi", State: "Delhi", City: "Connaught Place", Source: "IndiaMART",
  Requirement: "GX16 — Qty: 100", EstValue: "5000", Stage: "Follow-up", Priority: "Warm", LeadBy: "Vishu", QuoteNo: "", QuoteAmount: "",
  QuoteDate: "", NextFollowUp: "2026-09-03", LastContact: "2026-09-01", OrderValue: "", LostReason: "", DispatchDate: "", DispatchInfo: "",
  ShipmentWeight: "", FeedbackRating: "", FeedbackNote: "", Notes: "", Active: "YES", PhotoUrl: "", ClaimedAt: "", TransferTo: "",
  Qty: "100", Timeline: "Immediate", Grade: "A", Escalation: "", InvoiceNo: "", ...extra,
});

const input: SheetInput = {
  team: [{ Name: "Vishu", Active: "YES" }, { Name: "Sales 1", Active: "YES" }, { Name: "Vishu", Active: "YES" }],
  users: [{ Username: "vishu", Name: "Vishu", PassHash: "salt:hash", Role: "admin", Active: "YES", CreatedAt: "" }],
  customers: [
    { CustID: "CUST-0001", CreatedAt: "2026-09-01", Name: "Cust A", Company: "Acme", Phone: "9876500001", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "", Notes: "", Active: "YES" },
    { CustID: "CUST-0002", CreatedAt: "2026-09-01", Name: "Dup phone", Company: "", Phone: "+91 98765 00001", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "", Notes: "", Active: "YES" },
  ],
  enquiries: [
    enq("SETMI-ENQ-0001"),
    enq("SETMI-ENQ-0002", { Stage: "Won", Priority: "Hot", NextFollowUp: "2026-09-05", InvoiceNo: "INV-9", Phone: "9876500002", Notes: "x · MetaLeadID:9001" }),
    enq("SETMI-ENQ-0002", { Customer: "duplicate id" }),
    enq("", { Customer: "" , Phone: "", Requirement: "", Source: "", Stage: "", Priority: "", LeadBy: "", EnqDate: "", CreatedAt: "", Active: "", Qty: "", Timeline: "", Grade: "", NextFollowUp: "", LastContact: "", EstValue: "", Company: "", Pincode: "", District: "", State: "", City: "" }),
    enq("SETMI-ENQ-0004", { Stage: "Teleported" }),
    enq("SETMI-ENQ-0005", { Source: "Facebook", LeadBy: "Ex Employee", TransferTo: "Sales 1", Phone: "9876500005" }),
    enq("SETMI-ENQ-0006", { Active: "NO", Phone: "9876500006" }),
  ],
  archive: [enq("SETMI-ENQ-0007", { Stage: "Closed", Priority: "", NextFollowUp: "", Phone: "9876500007" })],
  pending: [
    { PendingID: "PEND-0001", CreatedAt: "2026-09-01T05:00:00.000Z", SubmittedBy: "Meta Ads auto-import", Customer: "P1", Company: "", Phone: "=+919876500009", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "Other", Priority: "Warm", LeadBy: "", EstValue: "", Requirement: "HDMI", Notes: "", PhotoUrl: "", Status: "Pending", ApprovedEnqID: "", ReviewedBy: "", ReviewedAt: "", RejectReason: "" },
    { PendingID: "PEND-0002", CreatedAt: "2026-09-01", SubmittedBy: "", Customer: "P2", Company: "", Phone: "9876500001", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "Phone", Priority: "", LeadBy: "Vishu", EstValue: "", Requirement: "", Notes: "", PhotoUrl: "https://drive.google.com/file/d/abc", Status: "Approved", ApprovedEnqID: "SETMI-ENQ-0001", ReviewedBy: "", ReviewedAt: "", RejectReason: "" },
    { PendingID: "PEND-0003", CreatedAt: "2026-09-01", SubmittedBy: "", Customer: "P3", Company: "", Phone: "9876500003", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "", Priority: "", LeadBy: "", EstValue: "", Requirement: "", Notes: "", PhotoUrl: "", Status: "Rejected", ApprovedEnqID: "", ReviewedBy: "", ReviewedAt: "", RejectReason: "" },
    { PendingID: "PEND-0004", CreatedAt: "2026-09-01", SubmittedBy: "", Customer: "P4", Company: "", Phone: "9876500004", Email: "", GST: "", Pincode: "", District: "", State: "", City: "", Source: "", Priority: "", LeadBy: "", EstValue: "", Requirement: "", Notes: "", PhotoUrl: "", Status: "Approved", ApprovedEnqID: "SETMI-ENQ-9999", ReviewedBy: "", ReviewedAt: "", RejectReason: "" },
  ],
  followups: [
    { FollowUpID: "FU-0408", CreatedAt: "2026-09-01 11:00", EnqID: "SETMI-ENQ-0001", Customer: "", Mode: "Call", Outcome: "Connected", NextFollowUp: "2026-09-03", By: "Vishu", Note: "" },
    { FollowUpID: "FU-0408", CreatedAt: "2026-09-01 12:00", EnqID: "SETMI-ENQ-0001", Customer: "", Mode: "Note", Outcome: "", NextFollowUp: "", By: "Vishu", Note: "dup id" },
    { FollowUpID: "FU-0500", CreatedAt: "2026-09-01", EnqID: "SETMI-ENQ-0404", Customer: "", Mode: "Call", Outcome: "", NextFollowUp: "", By: "", Note: "orphan" },
  ],
  calllog: [
    { CallLogID: "CALL-0001", CreatedAt: "2026-09-01 11:00", EnqID: "SETMI-ENQ-0001", Customer: "", CallNumber: "1", CallDate: "2026-09-01", Employee: "Vishu", Remarks: "", NextFollowUp: "", CallStatus: "Connected", Interest: "Interested" },
    { CallLogID: "CALL-0001", CreatedAt: "2026-09-02 11:00", EnqID: "SETMI-ENQ-0001", Customer: "", CallNumber: "1", CallDate: "2026-09-02", Employee: "Vishu", Remarks: "", NextFollowUp: "", CallStatus: "Busy", Interest: "Interested" },
  ],
};

let db: Db;
before(async () => {
  db = await createDb();
});

test("date parsing accepts the legacy formats and rejects impossible dates", () => {
  assert.equal(parseDate("2026-10-23"), "2026-10-23");
  assert.equal(parseDate("23/10/2026"), "2026-10-23");
  assert.equal(parseDate("23 Oct 2026"), "2026-10-23");
  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("garbage"), null);
});

test("transform accounts for every row and applies the documented fixes", () => {
  const t = transform(input);
  const r = t.report;
  assert.equal(r.enquiries.source_rows, 8);
  assert.equal(r.enquiries.valid + r.enquiries.rejected + r.enquiries.duplicates, 8, "every enquiry row accounted for");
  assert.equal(r.enquiries.duplicates, 1);
  assert.ok(t.issues.some((i) => i.detail.includes("unknown stage")));
  const won = t.enquiries.find((e) => e.enq_code === "SETMI-ENQ-0002")!;
  assert.equal(won.priority, null, "closed-out stage clears priority");
  assert.equal(won.next_follow_up, null);
  assert.equal(t.enquiries.find((e) => e.enq_code === "SETMI-ENQ-0005")!.source, "Other");
  assert.ok(t.team.some((m) => m.name === "Ex Employee" && !m.active), "unknown owner kept as inactive roster name");
  assert.equal(t.customers.find((c) => c.cust_code === "CUST-0002")!.active, false, "duplicate phone customer imported inactive");
  assert.equal(t.followUps.length, 2);
  assert.ok(t.followUps.some((f) => f.fu_code === "FU-0408-D1"), "duplicate FollowUpID renamed (BUG-003)");
  assert.deepEqual(t.calls.map((c) => c.call_number), [1, 2], "duplicate call numbers renumbered");
  assert.equal(t.calls[1].interest, null, "interest only when connected");
  assert.equal(t.pending.find((p) => p.pend_code === "PEND-0001")!.phone, "+919876500009", "formula phone cleaned (BUG-016)");
  assert.equal(t.pending.find((p) => p.pend_code === "PEND-0001")!.submitted_via, "meta_import");
  assert.equal(t.pending.find((p) => p.pend_code === "PEND-0003")!.reject_reason, "(not recorded in legacy sheet)");
  assert.equal(t.pending.find((p) => p.pend_code === "PEND-0004")!.status, "Pending", "approval pointing at a missing enquiry is re-queued");
  assert.deepEqual(t.users, [{ username: "vishu", full_name: "Vishu", role: "admin", active: true }], "no password hashes carried over");
  assert.equal(t.counters["SETMI-ENQ-"], 7);
});

test("apply loads everything, reconciles, and a re-run inserts nothing new", async () => {
  const t = transform(input);
  const first = await db.transaction(async (tx) => applyMigration(tx, t));
  assert.equal(first.enquiries, t.enquiries.length);
  assert.equal(first.call_logs, 2);
  assert.equal(first.enquiry_transfers, 1);
  assert.equal(first.external_lead_refs, 1);
  const rec = await reconcile(db, t);
  assert.equal(rec.ok, true, JSON.stringify(rec.differences));
  const second = await db.transaction(async (tx) => applyMigration(tx, t));
  assert.equal(Object.values(second).reduce((a, b) => a + b, 0), 0, "idempotent re-run");

  const e = (await db.query<Record<string, unknown>>(`select e.*, t.name owner_name from public.enquiries e left join public.team_members t on t.id = e.owner_id where enq_code = 'SETMI-ENQ-0001'`)).rows[0];
  assert.equal(e.owner_name, "Vishu");
  assert.equal(e.grade, "A");
  assert.ok(e.customer_id, "linked to customer by phone");
  const archived = (await db.query<{ archived_at: string | null }>(`select archived_at from public.enquiries where enq_code = 'SETMI-ENQ-0007'`)).rows[0];
  assert.ok(archived.archived_at);
  const approved = (await db.query<{ approved_enquiry_id: string | null; notes: string }>(`select approved_enquiry_id, notes from public.pending_enquiries where pend_code = 'PEND-0002'`)).rows[0];
  assert.ok(approved.approved_enquiry_id);
  assert.match(approved.notes, /Legacy document: https:\/\/drive/);
  const next = (await db.query<{ v: string }>(`select private.next_code('SETMI-ENQ-') v`)).rows[0].v;
  assert.equal(next, "SETMI-ENQ-0008", "new codes continue after the legacy ones");
});
