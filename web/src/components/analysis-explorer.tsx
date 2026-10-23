"use client";

import { useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { CONVERTED_STAGES } from "@/lib/domain/constants";

// Client-side explorer over compact, PII-free rows (legacy Data Analysis tab): changing a filter
// costs no server call. The server decides which rows a viewer may receive.
export type AnalysisRow = {
  month: string; product: string; qty: string; state: string; stage: string; source: string; owner: string | null;
  district: string; called: boolean; connected: boolean; interested: boolean; value: number;
  respDays: number | null; idleDays: number | null; repeat: number | null;
};

const DIMS = [
  ["product", "Product"], ["state", "State"], ["source", "Source"], ["stage", "Stage"], ["month", "Month"], ["district", "District"], ["owner", "Lead By"],
] as const;
type Dim = (typeof DIMS)[number][0];

function pct(a: number, b: number) {
  return b ? `${Math.round((a * 100) / b)}%` : "—";
}

export function AnalysisExplorer({ rows, shared }: { rows: AnalysisRow[]; shared: boolean }) {
  const [filters, setFilters] = useState<Partial<Record<Dim, string>>>({});
  const [dim, setDim] = useState<Dim>("product");
  const dims = DIMS.filter(([k]) => !(shared && k === "owner"));
  const options = useMemo(() => {
    const o: Partial<Record<Dim, string[]>> = {};
    for (const [k] of dims) o[k] = [...new Set(rows.map((r) => String(r[k] ?? "")).filter(Boolean))].sort();
    return o;
  }, [rows, dims]);
  const filtered = useMemo(
    () => rows.filter((r) => Object.entries(filters).every(([k, v]) => !v || String(r[k as Dim] ?? "") === v)),
    [rows, filters],
  );
  const k = useMemo(() => {
    const n = filtered.length;
    const called = filtered.filter((r) => r.called).length;
    const conn = filtered.filter((r) => r.connected).length;
    const inte = filtered.filter((r) => r.interested).length;
    const won = filtered.filter((r) => (CONVERTED_STAGES as readonly string[]).includes(r.stage)).length;
    const resp = filtered.map((r) => r.respDays).filter((x): x is number => x != null);
    const idle = filtered.map((r) => r.idleDays).filter((x): x is number => x != null);
    const avg = (a: number[]) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "—");
    return { n, called, conn, inte, won, resp: avg(resp), idle: avg(idle), repeat: filtered.filter((r) => (r.repeat ?? 1) > 1).length };
  }, [filtered]);
  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) {
      const key = String(r[dim] ?? "") || "(blank)";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    const items = [...m.entries()].map(([label, value]) => ({ label, value }));
    return dim === "month" ? items.sort((a, b) => b.label.localeCompare(a.label)) : items.sort((a, b) => b.value - a.value);
  }, [filtered, dim]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-2.5 p-3">
        {dims.map(([key, label]) => (
          <label key={key} className="min-w-[130px] flex-1 sm:flex-none">
            <span className="field-label">{label}</span>
            <select className="input" value={filters[key] ?? ""} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}>
              <option value="">All</option>
              {(options[key] ?? []).map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <button type="button" className="rounded-lg px-3 py-2 text-sm hover:bg-chip" onClick={() => setFilters({})}>Reset</button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Enquiries", k.n.toLocaleString("en-IN")],
          ["Called", `${pct(k.called, k.n)} (${k.called})`],
          ["Connected", `${pct(k.conn, k.n)} (${k.conn})`],
          ["Interested", `${pct(k.inte, k.n)} (${k.inte})`],
          ["Converted", `${pct(k.won, k.n)} (${k.won})`],
          ...(shared ? [] : [["Avg days to first call", k.resp], ["Avg days idle", k.idle], ["Repeat customers", String(k.repeat)]]),
        ].map(([l, v]) => (
          <div key={l} className="card p-3"><div className="text-xs font-semibold uppercase text-muted">{l}</div><div className="font-display text-xl font-bold">{v}</div></div>
        ))}
      </div>
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Break down by</span>
          {dims.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setDim(key)} aria-pressed={dim === key}
              className={`rounded-full px-3 py-1 text-sm ${dim === key ? "bg-cyan text-white" : "bg-chip hover:brightness-95"}`}>{label}</button>
          ))}
        </div>
        <BarList label={`Enquiries by ${dim}`} items={grouped} max={20} />
      </div>
    </div>
  );
}
