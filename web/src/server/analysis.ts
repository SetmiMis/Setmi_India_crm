import "server-only";
import { normalizeState } from "@/lib/domain/geo";
import { productLabel } from "@/lib/domain/products";
import type { AnalysisRow } from "@/components/analysis-explorer";

type Raw = {
  month: string; requirement_head: string; qty_text: string; state: string; stage: string; source: string; owner_name?: string;
  district: string; called: boolean; connected: boolean; interested: boolean; est_value: number | string;
  resp_days?: number | null; idle_days?: number | null; repeat_count?: number | null;
};

/** Map DB rows to explorer rows. The raw requirement text never leaves the server — only a product label. */
export function toAnalysisRows(raw: Raw[], shared: boolean): AnalysisRow[] {
  return raw.map((r) => ({
    month: r.month,
    product: productLabel(r.requirement_head),
    qty: String(r.qty_text ?? "").slice(0, 20),
    state: normalizeState(r.state)?.name ?? (r.state ? "Unrecognised" : ""),
    stage: r.stage,
    source: r.source,
    owner: shared ? null : r.owner_name ?? null,
    district: r.district ?? "",
    called: r.called,
    connected: r.connected,
    interested: r.interested,
    value: shared ? 0 : Number(r.est_value) || 0,
    respDays: shared ? null : r.resp_days ?? null,
    idleDays: shared ? null : r.idle_days ?? null,
    repeat: shared ? null : r.repeat_count ?? null,
  }));
}
