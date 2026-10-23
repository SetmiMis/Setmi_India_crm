import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { PageHeader, Card } from "@/components/ui/layout";
import { BarList } from "@/components/charts";
import { FilterBar, FilterField, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/button";
import { STAGES } from "@/lib/domain/constants";

export const metadata: Metadata = { title: "Reports" };

type Report = {
  sources: Array<{ source: string; enquiries: number; won: number; lost: number; win_rate: number }>;
  owners: Array<{ owner: string; enquiries: number; won: number; lost: number }>;
  stages: Record<string, number>;
  lost_reasons: Array<{ reason: string; count: number }>;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const s = await searchParams;
  const from = sp(s.from);
  const to = sp(s.to);
  const r = await readRpc<Report>("reports_summary", { p_date_from: from ?? null, p_date_to: to ?? null });
  const qs = new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Reports" subtitle="Source and team performance (won = Won + Dispatched + Closed)"
        actions={<LinkButton href={`/api/export/report?${qs}`} prefetch={false}>Download CSV</LinkButton>} />
      <FilterBar action="/reports">
        <FilterField label="Enquiry date from"><Input type="date" name="from" defaultValue={from} /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={to} /></FilterField>
      </FilterBar>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="By source" className="p-0">
          <div className="overflow-x-auto p-1">
            <table className="data">
              <thead><tr><th>Source</th><th className="text-right">Enquiries</th><th className="text-right">Won</th><th className="text-right">Lost</th><th className="text-right">Win %</th></tr></thead>
              <tbody>{r.sources.map((x) => (
                <tr key={x.source}><td>{x.source}</td><td className="text-right">{x.enquiries}</td><td className="text-right">{x.won}</td><td className="text-right">{x.lost}</td><td className="text-right">{x.win_rate}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card title="By Lead By" className="p-0">
          <div className="overflow-x-auto p-1">
            <table className="data">
              <thead><tr><th>Lead By</th><th className="text-right">Enquiries</th><th className="text-right">Won</th><th className="text-right">Lost</th></tr></thead>
              <tbody>{r.owners.map((x) => (
                <tr key={x.owner}><td>{x.owner}</td><td className="text-right">{x.enquiries}</td><td className="text-right">{x.won}</td><td className="text-right">{x.lost}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Stage mix">
          <BarList label="Enquiries by stage" items={STAGES.map((st) => ({ label: st, value: Number(r.stages[st] ?? 0) }))} />
        </Card>
        <Card title="Top lost reasons">
          <BarList label="Lost reasons" items={r.lost_reasons.map((x) => ({ label: x.reason, value: Number(x.count) }))} />
        </Card>
      </div>
    </>
  );
}
