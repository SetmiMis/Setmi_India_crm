import { test } from "node:test";
import assert from "node:assert/strict";
import { addWorkingDays, computeNextFollowUp, followUpStatus, todayIST, niceDate } from "../../src/lib/domain/dates";
import { gradeFor, nextStages } from "../../src/lib/domain/constants";
import { normalizeState, fuzzyNormalizeState, zoneOf } from "../../src/lib/domain/geo";
import { productLabel } from "../../src/lib/domain/products";
import { waLink, waNumber, welcomeMessage } from "../../src/lib/domain/whatsapp";
import { callLogSchema, pendingEnquirySchema, publicEnquirySchema, stageMoveSchema, fieldErrors } from "../../src/lib/domain/validation";

test("working days skip Sundays and holidays (mirror of the SQL rule)", () => {
  assert.equal(addWorkingDays("2026-10-24", 1), "2026-10-26"); // Sat → Mon
  assert.equal(computeNextFollowUp("Cold", "2026-10-24"), "2026-10-31");
  assert.equal(computeNextFollowUp("Warm", "2026-10-24"), "2026-10-27");
  assert.equal(computeNextFollowUp(undefined, "2026-10-24"), "2026-10-27");
  assert.equal(addWorkingDays("2026-10-24", 1, new Set(["2026-10-26"])), "2026-10-27");
});

test("follow-up status buckets", () => {
  assert.equal(followUpStatus(null, "2026-10-23"), "No Follow-up");
  assert.equal(followUpStatus("2026-10-22", "2026-10-23"), "Overdue");
  assert.equal(followUpStatus("2026-10-23", "2026-10-23"), "Today");
  assert.equal(followUpStatus("2026-10-24", "2026-10-23"), "Tomorrow");
  assert.equal(followUpStatus("2026-11-01", "2026-10-23"), "Upcoming");
});

test("todayIST uses the Kolkata calendar day", () => {
  assert.equal(todayIST(new Date("2026-10-22T19:00:00Z")), "2026-10-23"); // 00:30 IST
  assert.equal(todayIST(new Date("2026-10-22T18:00:00Z")), "2026-10-22"); // 23:30 IST
  assert.equal(niceDate("2026-10-23"), "23 Oct 2026");
});

test("grade matrix matches SQL and legacy", () => {
  assert.equal(gradeFor(600, "Just Exploring"), "B");
  assert.equal(gradeFor(100, "Immediate"), "A");
  assert.equal(gradeFor(5, "Immediate"), "B");
  assert.equal(gradeFor(5, "Fortnight"), "C");
  assert.equal(gradeFor(null, "Immediate"), null);
});

test("stage options mirror database transitions", () => {
  assert.deepEqual(nextStages("Won", false), ["Dispatched", "Closed"]);
  assert.deepEqual(nextStages("Lost", false), []);
  assert.deepEqual(nextStages("Lost", true), ["Follow-up"]);
  assert.deepEqual(nextStages("Closed", true), []);
});

test("state normalisation and zones", () => {
  assert.deepEqual(normalizeState("west bengal(india)"), { iso: "IN-WB", name: "West Bengal" });
  assert.deepEqual(normalizeState("NCT of Delhi"), { iso: "IN-DL", name: "Delhi" });
  assert.equal(normalizeState("Atlantis"), null);
  assert.equal(fuzzyNormalizeState("Maharshtra")?.name, "Maharashtra");
  assert.equal(fuzzyNormalizeState("Pun"), null, "too short to fuzzy-match");
  assert.equal(zoneOf("Tamil Nadu"), "South");
  assert.equal(zoneOf("TN"), "South");
  assert.equal(zoneOf(""), "Unclassified");
});

test("product labels (legacy analysisProduct_)", () => {
  assert.equal(productLabel("waterproof_connector_ip68"), "Waterproof Circular Connectors");
  assert.equal(productLabel("HDMI cable"), "HDMI Connectors");
  assert.equal(productLabel("GX16 4 pin"), "Circular Connectors");
  assert.equal(productLabel("metal push button switch"), "Metal Push Button Switches");
  assert.equal(productLabel(""), "Unknown");
  assert.equal(productLabel("random thing"), "Other");
});

test("WhatsApp links add 91 to 10-digit numbers and encode the message", () => {
  assert.equal(waNumber("98765 43210"), "919876543210");
  const link = waLink({ customer_name: "Ravi", phone: "9876543210", requirement: "GX16", owner_name: "Vishu" }, "welcome");
  assert.ok(link?.startsWith("https://wa.me/919876543210?text="));
  assert.match(welcomeMessage({ customer_name: "Ravi" }), /SETMI INDIA/);
  assert.equal(waLink({ phone: "" }, "follow"), null);
});

test("intake validation rejects bad formats with field-level messages", () => {
  const bad = pendingEnquirySchema.safeParse({ customer_name: "", phone: "123", email: "x@", pincode: "12", gst: "abc" });
  assert.equal(bad.success, false);
  const errs = fieldErrors(bad.error!);
  for (const k of ["customer_name", "phone", "email", "pincode", "gst"]) assert.ok(errs[k], `error for ${k}`);
  const ok = pendingEnquirySchema.safeParse({ customer_name: "Ravi", phone: "+91 98765-43210", gst: "27abcde1234f1z5", qty: "50", est_value: "" });
  assert.equal(ok.success, true);
  assert.equal(ok.data?.gst, "27ABCDE1234F1Z5");
  assert.equal(ok.data?.est_value, null);
});

test("public form: honeypot and token required; extra fields are dropped", () => {
  const base = { customer_name: "A", phone: "9876543210", requirement: "need cables", form_token: "x".repeat(20) };
  assert.equal(publicEnquirySchema.safeParse({ ...base, website: "http://spam" }).success, false);
  assert.equal(publicEnquirySchema.safeParse({ ...base, form_token: "" }).success, false);
  const r = publicEnquirySchema.safeParse({ ...base, owner_id: "x", priority: "Hot" });
  assert.equal(r.success, true);
  assert.equal("owner_id" in (r.data as object), false);
});

test("stage move: Won needs invoice, Lost needs reason, rating 1–5", () => {
  assert.equal(stageMoveSchema.safeParse({ stage: "Won", version: 1 }).success, false);
  assert.equal(stageMoveSchema.safeParse({ stage: "Won", version: 1, invoice_no: "INV-1" }).success, true);
  assert.equal(stageMoveSchema.safeParse({ stage: "Lost", version: 1 }).success, false);
  assert.equal(stageMoveSchema.safeParse({ stage: "Closed", version: 1, feedback_rating: "7" }).success, false);
  assert.equal(stageMoveSchema.safeParse({ stage: "Teleported", version: 1 }).success, false);
});

test("call log: interest is dropped unless connected; request id required", () => {
  const id = crypto.randomUUID();
  const r = callLogSchema.parse({ call_status: "Busy", interest: "Interested", client_request_id: id });
  assert.equal(r.interest, null);
  const c = callLogSchema.parse({ call_status: "Connected", interest: "Interested", client_request_id: id });
  assert.equal(c.interest, "Interested");
  assert.equal(callLogSchema.safeParse({ call_status: "Connected" }).success, false);
});

test("server log redaction removes phones, emails, JWTs and secret keys", async () => {
  const { redact, fromDbError } = await import("../../src/lib/errors");
  const out = redact("call 9876543210 mail a.b@x.in jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc key sb_secret_abcdefghijklmnop");
  assert.equal(/9876543210|a\.b@x\.in|eyJhbG|sb_secret_a/.test(out), false, out);
  assert.deepEqual(fromDbError({ message: "Already claimed by X", hint: "conflict" }), { ok: false, code: "conflict", message: "Already claimed by X" });
  const hidden = fromDbError({ message: "relation secret_table does not exist", code: "42P01" });
  assert.equal(hidden.code, "internal");
  assert.equal(hidden.message.includes("secret_table"), false, "unknown DB errors are not echoed to users");
});
