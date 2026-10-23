"use client";

import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import type { Row } from "@/lib/domain/imports";

export type ParsedSheet = { tab: string; headers: string[]; rows: Row[] };

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

/** Parse a CSV or XLSX in the browser into header-keyed string rows (every tab for XLSX). */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet[]> {
  if (file.size > MAX_BYTES) throw new Error("File is larger than 5 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const headers = (res.meta.fields ?? []).filter(Boolean);
    return [{ tab: "CSV", headers, rows: res.data.slice(0, MAX_ROWS).map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "")]))) }];
  }
  if (name.endsWith(".xlsx")) {
    const sheets = await readXlsxFile(file);
    return sheets
      .map((s) => {
        const [head = [], ...body] = s.data;
        const headers = head.map((h) => String(h ?? "").trim());
        const rows = body
          .slice(0, MAX_ROWS)
          .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? "" : r[i] instanceof Date ? (r[i] as Date).toISOString().slice(0, 10) : String(r[i])])))
          .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
        return { tab: s.sheet, headers: headers.filter(Boolean), rows };
      })
      .filter((s) => s.rows.length > 0);
  }
  throw new Error("Upload a .csv or .xlsx file.");
}
