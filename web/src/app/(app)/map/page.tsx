import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { leadSources } from "@/server/queries";
import { env } from "@/lib/env";
import { PageHeader, Card } from "@/components/ui/layout";
import { FilterBar, FilterField, FilterSelect, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { BarList } from "@/components/charts";
import { STAGES } from "@/lib/domain/constants";
import { normalizeState, stateCentroid, zoneOf, ZONES } from "@/lib/domain/geo";
import { MapView, type MapPoint } from "./map-view";

export const metadata: Metadata = { title: "MAP Analytics" };

type Agg = { state: string; district: string; pincode: string | null; lat: number | null; lng: number | null; source: string; total: number; open_: number; won: number; lost: number; value: number };

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const f = { date_from: sp(s.from), date_to: sp(s.to), source: sp(s.source), stage: sp(s.stage) };
  const [rows, sources] = await Promise.all([readRpc<Agg[]>("map_aggregate", { p_filters: f }), leadSources()]);

  // Place each group: pincode centroid → state centroid (legacy order, minus live geocoding).
  const points = new Map<string, MapPoint>();
  const zones = new Map<string, { total: number; won: number; lost: number; open: number }>();
  const unplaced = { total: 0 };
  for (const r of rows) {
    const st = normalizeState(r.state)?.name ?? null;
    const ll: [number, number] | null = r.lat != null && r.lng != null ? [Number(r.lat), Number(r.lng)] : st ? stateCentroid(st) : null;
    const zone = zoneOf(st);
    const z = zones.get(zone) ?? { total: 0, won: 0, lost: 0, open: 0 };
    z.total += Number(r.total); z.won += Number(r.won); z.lost += Number(r.lost); z.open += Number(r.open_);
    zones.set(zone, z);
    if (!ll) { unplaced.total += Number(r.total); continue; }
    const key = `${ll[0].toFixed(2)},${ll[1].toFixed(2)}`;
    const p = points.get(key) ?? { lat: ll[0], lng: ll[1], label: r.pincode ? [r.district || r.pincode, st ?? r.state].filter(Boolean).join(", ") : `${st} (state)`, total: 0, won: 0, lost: 0, open: 0, approx: !r.pincode };
    p.total += Number(r.total); p.won += Number(r.won); p.lost += Number(r.lost); p.open += Number(r.open_);
    points.set(key, p);
  }
  const zoneRows = [...ZONES, "Unclassified" as const].map((z) => ({ zone: z, ...(zones.get(z) ?? { total: 0, won: 0, lost: 0, open: 0 }) }));

  return (
    <>
      <PageHeader title="MAP Analytics" subtitle={`${user.isAdmin ? "All" : "Your"} enquiries by place. Dots sit on the pincode centre; hollow dots are state-level (no pincode).`} />
      <FilterBar action="/map">
        <FilterField label="From"><Input type="date" name="from" defaultValue={f.date_from} /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={f.date_to} /></FilterField>
        <FilterField label="Source"><FilterSelect name="source" value={f.source} options={sources} /></FilterField>
        <FilterField label="Stage"><FilterSelect name="stage" value={f.stage} options={STAGES} /></FilterField>
      </FilterBar>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-2">
          <MapView points={[...points.values()]} tileUrl={env().MAP_TILE_URL} />
          {unplaced.total ? <p className="px-2 pt-2 text-xs text-muted">{unplaced.total} enquiry(ies) have no recognisable pincode or state and are not on the map.</p> : null}
        </Card>
        <div className="space-y-4">
          <Card title="Zones" className="p-0">
            <table className="data">
              <thead><tr><th>Zone</th><th className="text-right">Enquiries</th><th className="text-right">Open</th><th className="text-right" title="Converted (Won/Dispatched/Closed)">Zone in</th><th className="text-right" title="Lost">Zone out</th></tr></thead>
              <tbody>{zoneRows.filter((z) => z.total > 0).map((z) => (
                <tr key={z.zone}><td>{z.zone}</td><td className="text-right">{z.total}</td><td className="text-right">{z.open}</td><td className="text-right text-green-dk">{z.won}</td><td className="text-right text-red">{z.lost}</td></tr>
              ))}</tbody>
            </table>
          </Card>
          <Card title="Top places">
            <BarList label="Enquiries by place" items={[...points.values()].sort((a, b) => b.total - a.total).map((p) => ({ label: p.label, value: p.total }))} max={15} />
          </Card>
        </div>
      </div>
    </>
  );
}
