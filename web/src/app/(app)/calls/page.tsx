import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { userClient } from "@/lib/supabase/server";
import { teamMembers } from "@/server/queries";
import { PageHeader, Card, Kpi, EmptyState } from "@/components/ui/layout";
import { FilterBar, FilterField, FilterSelect, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { niceDate, todayIST } from "@/lib/domain/dates";
import { CALL_STATUSES } from "@/lib/domain/constants";

export const metadata: Metadata = { title: "Call Management" };

const PAGE = 40;

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const page = pageFromParams(s.page);
  const date = sp(s.date) ?? todayIST();
  const status = sp(s.status);
  const who = user.isAdmin ? sp(s.who) : undefined;
  const [kpi, team] = await Promise.all([
    readRpc<{ todays_calls: number; completed_calls: number; missed_calls: number; pending_calls: number }>("call_dashboard"),
    user.isAdmin ? teamMembers(true) : Promise.resolve([]),
  ]);
  const supabase = await userClient();
  let q = supabase
    .from("call_logs")
    .select("id, call_code, call_number, call_date, employee_label, remarks, call_status, interest, next_follow_up, enquiry:enquiries(id, enq_code, customer_name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) q = q.eq("call_date", date);
  if (status && (CALL_STATUSES as readonly string[]).includes(status)) q = q.eq("call_status", status);
  if (who && /^[0-9a-f-]{36}$/i.test(who)) q = q.eq("employee_member_id", who);
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as Array<{
    id: string; call_code: string; call_number: number; call_date: string; employee_label: string; remarks: string; call_status: string;
    interest: string | null; next_follow_up: string | null; enquiry: { id: string; enq_code: string; customer_name: string } | null;
  }>;

  return (
    <>
      <PageHeader title="Call Management" subtitle={user.isAdmin ? "Team call activity" : "Your call activity"} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Calls today" value={kpi.todays_calls} />
        <Kpi label="Connected" value={kpi.completed_calls} tone="good" />
        <Kpi label="Not connected" value={kpi.missed_calls} tone="bad" />
        <Kpi label="Still to call today" value={kpi.pending_calls} tone="warn" href="/follow-ups" />
      </div>
      <div className="mt-4">
        <FilterBar action="/calls">
          <FilterField label="Call date"><Input type="date" name="date" defaultValue={date} /></FilterField>
          <FilterField label="Status"><FilterSelect name="status" value={status} options={CALL_STATUSES} /></FilterField>
          {user.isAdmin ? <FilterField label="Employee"><FilterSelect name="who" value={who} options={team.map((t) => ({ value: t.id, label: t.name }))} /></FilterField> : null}
        </FilterBar>
      </div>
      <Card className="p-0">
        {rows.length === 0 ? <EmptyState title={`No calls on ${niceDate(date)}`} /> : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Enquiry</th><th>#</th><th>Status</th><th>Interest</th><th>By</th><th>Remarks</th><th>Next follow-up</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>{c.enquiry ? <Link className="font-medium text-cyan-dk hover:underline" href={`/enquiries/${c.enquiry.id}`}>{c.enquiry.customer_name}</Link> : "—"}<div className="text-xs text-muted">{c.enquiry?.enq_code} · {c.call_code}</div></td>
                    <td>{c.call_number}</td><td>{c.call_status}</td><td>{c.interest ?? "—"}</td><td>{c.employee_label}</td>
                    <td className="max-w-[280px]">{c.remarks}</td><td className="whitespace-nowrap">{niceDate(c.next_follow_up)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3"><Pagination basePath="/calls" params={{ date, status, who }} page={page} pageSize={PAGE} total={count ?? 0} /></div>
      </Card>
    </>
  );
}
