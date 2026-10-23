import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { leadSources, teamMembers } from "@/server/queries";
import { PageHeader, Card, Kpi, Notice } from "@/components/ui/layout";
import { BarList, ColumnChart, Funnel } from "@/components/charts";
import { FilterBar, FilterField, FilterSelect, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { inr, num } from "@/lib/cn";
import { PRIORITIES, STAGES } from "@/lib/domain/constants";
import { normalizeState } from "@/lib/domain/geo";
import { niceTimestamp } from "@/lib/domain/dates";

export const metadata: Metadata = { title: "Dashboard" };

type Dash = {
  kpis: {
    total_enquiries: number; active_pipeline: number; pipeline_value: number; won_revenue: number; won_month_count: number;
    hot: number; warm: number; cold: number; overdue: number; due_today: number; win_rate: number;
    contacted: number; contacted_pct: number; approved: number; approved_pct: number; converted: number; converted_pct: number;
    esc_proprietor: number; esc_shop_floor: number; grade_a_open: number; funnel: Record<string, number>; as_of: string;
  };
  charts: {
    months: Array<{ month: string; count: number }>;
    sources: Array<{ label: string; count: number }>;
    priorities: Record<"Hot" | "Warm" | "Cold", number>;
    owners: Array<{ label: string; count: number }>;
    states: Array<{ state: string; count: number; value: number }>;
  };
};
type Calls = { todays_calls: number; completed_calls: number; missed_calls: number; pending_calls: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const f = { date_from: sp(s.from), date_to: sp(s.to), owner_id: sp(s.owner), source: sp(s.source), priority: sp(s.priority), stage: sp(s.stage) };
  const [d, calls, sources, team] = await Promise.all([
    readRpc<Dash>("dashboard", { p_filters: f }),
    readRpc<Calls>("call_dashboard"),
    leadSources(),
    user.isAdmin ? teamMembers(true) : Promise.resolve([]),
  ]);
  const k = d.kpis;

  // Normalise free-text state names into canonical states (legacy normalizeState_).
  const stateTotals = new Map<string, number>();
  for (const r of d.charts.states) {
    const name = normalizeState(r.state)?.name ?? "Unrecognised";
    stateTotals.set(name, (stateTotals.get(name) ?? 0) + Number(r.count));
  }
  const pipeHref = (extra: Record<string, string>) => `/pipeline?${new URLSearchParams({ ...extra }).toString()}`;

  return (
    <>
      <PageHeader
        title={`Namaste, ${user.fullName.split(" ")[0]}`}
        subtitle={<>{user.isAdmin ? "Company-wide view" : "Your leads only"} · as of {niceTimestamp(k.as_of)}</>}
      />
      {s.denied ? <div className="mb-4"><Notice tone="warn">That page is for admins only.</Notice></div> : null}

      <FilterBar action="/dashboard">
        <FilterField label="From"><Input type="date" name="from" defaultValue={f.date_from} /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={f.date_to} /></FilterField>
        {user.isAdmin ? (
          <FilterField label="Lead By">
            <FilterSelect name="owner" value={f.owner_id} options={[{ value: "unassigned", label: "Unassigned" }, ...team.map((t) => ({ value: t.id, label: t.name }))]} />
          </FilterField>
        ) : null}
        <FilterField label="Source"><FilterSelect name="source" value={f.source} options={sources} /></FilterField>
        <FilterField label="Priority"><FilterSelect name="priority" value={f.priority} options={PRIORITIES} /></FilterField>
        <FilterField label="Stage"><FilterSelect name="stage" value={f.stage} options={STAGES} /></FilterField>
      </FilterBar>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total enquiries" value={num(k.total_enquiries)} href="/pipeline" />
        <Kpi label="Active pipeline" value={num(k.active_pipeline)} sub={inr(k.pipeline_value)} tone="info" href={pipeHref({ stage: "open" })} />
        <Kpi label="Overdue" value={num(k.overdue)} tone={k.overdue ? "bad" : "good"} href="/follow-ups" />
        <Kpi label="Due today" value={num(k.due_today)} tone="warn" href="/follow-ups" />
        <Kpi label="Won this month" value={num(k.won_month_count)} sub={`${inr(k.won_revenue)} order value`} tone="good" href={pipeHref({ stage: "Won" })} />
        <Kpi label="Win rate" value={`${k.win_rate}%`} sub="won ÷ (won + lost)" />
      </div>

      {/* FMS "Command Center" funnel (PDF): Contacted → Approved → Converted */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Contacted" value={`${k.contacted_pct}%`} sub={`${num(k.contacted)} of ${num(k.total_enquiries)} leads touched`} />
        <Kpi label="Approved (quoted+)" value={`${k.approved_pct}%`} sub={`${num(k.approved)} of contacted reached Quoted or beyond`} />
        <Kpi label="Converted" value={`${k.converted_pct}%`} sub={`${num(k.converted)} of approved won`} tone="good" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Today’s calls">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div><div className="font-display text-2xl font-bold">{calls.todays_calls}</div><div className="text-xs text-muted">Calls logged</div></div>
            <div><div className="font-display text-2xl font-bold text-green-dk">{calls.completed_calls}</div><div className="text-xs text-muted">Connected</div></div>
            <div><div className="font-display text-2xl font-bold text-red">{calls.missed_calls}</div><div className="text-xs text-muted">Not connected</div></div>
            <div><div className="font-display text-2xl font-bold text-gold">{calls.pending_calls}</div><div className="text-xs text-muted">Still to call today</div></div>
          </div>
        </Card>
        <Card title="Open leads by priority">
          <BarList label="Open leads by priority" items={[
            { label: "Hot", value: k.hot, href: pipeHref({ stage: "open", priority: "Hot" }) },
            { label: "Warm", value: k.warm, href: pipeHref({ stage: "open", priority: "Warm" }) },
            { label: "Cold / not set", value: k.cold, href: pipeHref({ stage: "open", priority: "Cold" }) },
          ]} />
          <p className="mt-3 text-xs text-muted">
            Grade A open: <b>{k.grade_a_open}</b> · Escalations — Proprietor: <b>{k.esc_proprietor}</b>, Shop floor: <b>{k.esc_shop_floor}</b>
          </p>
        </Card>
        <Card title="Pipeline by stage">
          <Funnel total={k.total_enquiries} stages={STAGES.map((st) => ({ stage: st, count: k.funnel[st] ?? 0, href: pipeHref({ stage: st }) }))} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Enquiries — last 6 months">
          <ColumnChart label="Enquiries per month" items={d.charts.months.map((m) => ({ label: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`, value: Number(m.count) }))} />
        </Card>
        <Card title="By source">
          <BarList label="Enquiries by source" items={d.charts.sources.map((x) => ({ label: x.label, value: Number(x.count), href: pipeHref({ source: x.label }) }))} />
        </Card>
        {user.isAdmin ? (
          <Card title="By Lead By">
            <BarList label="Enquiries by owner" items={d.charts.owners.map((x) => ({ label: x.label, value: Number(x.count) }))} />
          </Card>
        ) : null}
        <Card title="By state">
          <BarList label="Enquiries by state" items={[...stateTotals.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} />
        </Card>
      </div>
    </>
  );
}
