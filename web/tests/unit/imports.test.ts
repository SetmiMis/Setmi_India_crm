import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBulkMapping, guessBulkMapping, mapMetaRows, neutralizeFormula, sanitizeCell, stripMetaTag, toCsv } from "../../src/lib/domain/imports";

test("Meta tag prefixes are stripped (legacy stripMetaTag_)", () => {
  assert.equal(stripMetaTag("p:+917303810757"), "+917303810757");
  assert.equal(stripMetaTag("z:201012"), "201012");
  assert.equal(stripMetaTag("plain"), "plain");
});

test("Meta rows: header aliases, Qty folded into requirement, id fallback per tab, contact-less rows skipped", () => {
  const headers = ["Lead_ID", "full_name", "phone_number", "product_interested_in", "expected_order_quantity", "post_code", "email"];
  const rows = [
    { Lead_ID: "L1", full_name: "Ravi", phone_number: "p:+919876543210", product_interested_in: "waterproof", expected_order_quantity: "100", post_code: "z:110001", email: "r@x.in" },
    { Lead_ID: "", full_name: "", phone_number: "", product_interested_in: "x", expected_order_quantity: "", post_code: "", email: "" },
  ];
  const out = mapMetaRows(headers, rows, "Sheet2");
  assert.equal(out.length, 1);
  assert.equal(out[0].external_id, "L1");
  assert.equal(out[0].phone, "+919876543210");
  assert.equal(out[0].pincode, "110001");
  assert.equal(out[0].requirement, "waterproof — Qty: 100");
  assert.equal("email" in out[0].raw, false, "PII columns are not kept in raw metadata");
  const noId = mapMetaRows(["name", "phone"], [{ name: "A", phone: "9" }], "Sheet2");
  assert.equal(noId[0].external_id, "Sheet2-row-1");
});

test("bulk mapping is guessed from common headers", () => {
  const m = guessBulkMapping(["Customer Name", "Mobile Number", "Product", "Qty", "Remarks"]);
  assert.deepEqual([m.name, m.phone, m.requirement, m.quantity, m.remark], ["Customer Name", "Mobile Number", "Product", "Qty", "Remarks"]);
});

test("spreadsheet formula injection is neutralised on import and export", () => {
  assert.equal(neutralizeFormula('=HYPERLINK("http://evil")'), `'=HYPERLINK("http://evil")`);
  assert.equal(neutralizeFormula("+91 98765"), "'+91 98765");
  assert.equal(neutralizeFormula("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(neutralizeFormula("normal"), "normal");
  assert.equal(sanitizeCell("a\u0000b\u0007c"), "abc");
  const rows = applyBulkMapping([{ N: "=cmd|' /C calc'!A0", P: "+919876543210" }], { name: "N", phone: "P" });
  assert.ok(rows[0].name.startsWith("'="));
  assert.equal(rows[0].phone, "+919876543210", "phone keeps its + after neutralisation is undone");
  const csv = toCsv(["a", "b"], [["=1+1", 'say "hi", ok']]);
  assert.equal(csv, `a,b\r\n'=1+1,"say ""hi"", ok"\r\n`);
});
