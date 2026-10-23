import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { PageHeader, Card, EmptyState } from "@/components/ui/layout";
import { niceTimestamp } from "@/lib/domain/dates";

export const metadata: Metadata = { title: "Team Performance" };

type Perf = {
  reps: Array<{ name: string; active: boolean; leads: number; open: number; overdue: number; calls_month: number; calls_today: number; followups_month: number; won: number; lost: number; win_rate: number }>;
  as_of: string;
};

export default async function TeamPerformancePage() {
  await requireAdmin();
  const p = await readRpc<Perf>("team_performance");
  const totals = p.reps.reduce((t, r) => ({ leads: t.leads + r.leads, won: t.won + r.won, lost: t.lost + r.lost, calls: t.calls + r.calls_month }), { leads: 0, won: 0, lost: 0, calls: 0 });
  return (
    <>
      <PageHeader title="Team Performance" subtitle={`Leaderboard · as of ${niceTimestamp(p.as_of)} · sorted by won, then leads, then calls`} />
      <Card className="p-0">
        {p.reps.length === 0 ? <EmptyState title="No team activity yet" /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>#</th><th>Name</th><th className="text-right">Leads</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Calls (month)</th><th className="text-right">Calls today</th><th className="text-right">Follow-ups (month)</th><th className="text-right">Won</th><th className="text-right">Lost</th><th className="text-right">Win %</th></tr></thead>
              <tbody>
                {p.reps.map((r, i) => (
                  <tr key={r.name}>
                    <td>{i + 1}</td><td className="font-medium">{r.name}{!r.active ? <span className="text-xs text-muted"> (inactive)</span> : null}</td>
                    <td className="text-right">{r.leads}</td><td className="text-right">{r.open}</td>
                    <td className={`text-right ${r.overdue ? "font-semibold text-red" : ""}`}>{r.overdue}</td>
                    <td className="text-right">{r.calls_month}</td><td className="text-right">{r.calls_today}</td><td className="text-right">{r.followups_month}</td>
                    <td className="text-right font-semibold text-green-dk">{r.won}</td><td className="text-right">{r.lost}</td><td className="text-right">{r.win_rate}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td /><td>Total</td><td className="text-right">{totals.leads}</td><td colSpan={2} /><td className="text-right">{totals.calls}</td><td colSpan={2} /><td className="text-right">{totals.won}</td><td className="text-right">{totals.lost}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
