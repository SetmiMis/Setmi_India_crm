// Spreadsheet import helpers shared by Bulk Import and the Meta Ads importer.
// Pure functions (no I/O) so they are unit-tested in tests/unit.

export type Row = Record<string, string>;

/** Legacy META_HEADER_ALIASES_ (src/MetaLeadsImport.js), matched case-insensitively. */
export const META_HEADER_ALIASES = {
  id: ["id", "lead_id", "leadgen_id"],
  createdTime: ["created_time", "created_at", "date"],
  name: ["full_name", "name", "customer", "customer name"],
  phone: ["phone_number", "phone", "mobile", "mobile number", "contact"],
  company: ["company", "company_name", "business"],
  city: ["city"],
  pincode: ["post_code", "pincode", "zip", "zip_code"],
  product: ["product_interested_in", "product", "product_name", "interest"],
  quantity: ["expected_order_quantity", "quantity", "order_quantity"],
} as const;

export function findColumn(headers: readonly string[], aliases: readonly string[]): string | undefined {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const a of aliases) {
    const i = lower.indexOf(a);
    if (i >= 0) return headers[i];
  }
  return undefined;
}

/** Legacy stripMetaTag_: Meta exports prefix values like "p:+917303810757" or "z:201012". */
export function stripMetaTag(v: string | null | undefined): string {
  return String(v ?? "").replace(/^[a-z]{1,3}:\s*/i, "").trim();
}

export type MetaLead = {
  external_id: string;
  name: string;
  phone: string;
  company: string;
  city: string;
  pincode: string;
  requirement: string;
  qty: string;
  raw: Record<string, string>;
};

/** Map one sheet/tab of Meta rows. Rows without an id get "<tab>-row-<n>" like the legacy importer. */
export function mapMetaRows(headers: readonly string[], rows: readonly Row[], tabName = "Sheet1"): MetaLead[] {
  const col = (k: keyof typeof META_HEADER_ALIASES) => findColumn(headers, META_HEADER_ALIASES[k]);
  const c = {
    id: col("id"), name: col("name"), phone: col("phone"), company: col("company"),
    city: col("city"), pincode: col("pincode"), product: col("product"), quantity: col("quantity"),
  };
  const get = (r: Row, k?: string) => (k ? String(r[k] ?? "").trim() : "");
  const out: MetaLead[] = [];
  rows.forEach((r, i) => {
    const name = get(r, c.name);
    const phone = stripMetaTag(get(r, c.phone));
    if (!name && !phone) return;
    const product = get(r, c.product);
    const qty = get(r, c.quantity);
    out.push({
      external_id: c.id ? get(r, c.id) : `${tabName}-row-${i + 1}`,
      name,
      phone,
      company: get(r, c.company),
      city: get(r, c.city),
      pincode: stripMetaTag(get(r, c.pincode)),
      requirement: [product, qty ? `Qty: ${qty}` : ""].filter(Boolean).join(" — "),
      qty: qty.replace(/[^\d.]/g, ""),
      raw: Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => !/phone|mobile|email/i.test(k))
          .slice(0, 30)
          .map(([k, v]) => [k.slice(0, 60), String(v).slice(0, 200)]),
      ),
    });
  });
  return out;
}

export type BulkMapping = {
  name?: string;
  phone?: string;
  company?: string;
  requirement?: string;
  quantity?: string;
  source?: string;
  priority?: string;
  remark?: string;
};

/** Guess a Bulk Import column mapping from header names (user can override in the UI). */
export function guessBulkMapping(headers: readonly string[]): BulkMapping {
  const pick = (...aliases: string[]) => findColumn(headers, aliases);
  return {
    name: pick("name", "customer", "customer name", "contact name", "full_name", "buyer name"),
    phone: pick("phone", "mobile", "mobile number", "phone number", "contact", "contact number", "phone_number"),
    company: pick("company", "company name", "firm", "business"),
    requirement: pick("requirement", "product", "product name", "item", "enquiry", "query"),
    quantity: pick("quantity", "qty", "order quantity"),
    source: pick("source", "lead source"),
    priority: pick("priority"),
    remark: pick("remark", "remarks", "note", "notes", "comment"),
  };
}

/** Neutralise spreadsheet formula injection: text that a spreadsheet would execute gets a leading quote. */
export function neutralizeFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Strip characters that could carry formulas or control codes before storing imported text. */
export function sanitizeCell(v: unknown, max = 500): string {
  return neutralizeFormula(
    String(v ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim(),
  ).slice(0, max);
}

export function applyBulkMapping(rows: readonly Row[], m: BulkMapping) {
  const g = (r: Row, k?: string) => (k ? sanitizeCell(r[k]) : "");
  return rows.map((r) => ({
    name: g(r, m.name),
    phone: g(r, m.phone).replace(/^'/, ""),
    company: g(r, m.company),
    requirement: g(r, m.requirement),
    quantity: g(r, m.quantity),
    source: g(r, m.source),
    priority: g(r, m.priority),
    remark: g(r, m.remark),
  }));
}

/** CSV export with formula-injection protection and RFC 4180 quoting. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const cell = (v: unknown) => {
    const s = neutralizeFormula(v == null ? "" : String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
