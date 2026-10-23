import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { incomingTransfers, leadSources, listEnquiries, teamMembers, type EnquiryFilters } from "@/server/queries";
import { respondTransfer } from "@/server/actions/enquiries";
import { PageHeader, Card, EmptyState } from "@/components/ui/layout";
import { FilterBar, FilterField, FilterSelect, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { FollowUpBadge, GradeBadge, PriorityBadge, StageBadge } from "@/components/ui/badges";
import { ActionButton } from "@/components/action-form";
import { LinkButton } from "@/components/ui/button";
import { niceDate, todayIST } from "@/lib/domain/dates";
import { PRIORITIES, STAGES } from "@/lib/domain/constants";
import { inr } from "@/lib/cn";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const f: EnquiryFilters = {
    q: sp(s.q), stage: sp(s.stage), source: sp(s.source), owner: user.isAdmin ? sp(s.owner) : undefined, priority: sp(s.priority),
    follow: sp(s.follow), from: sp(s.from), to: sp(s.to), state: sp(s.state), city: sp(s.city), grade: sp(s.grade),
    view: user.isAdmin ? sp(s.view) : undefined, sort: sp(s.sort),
  };
  const page = pageFromParams(s.page);
  const [{ rows, total }, sources, team, incoming] = await Promise.all([
    listEnquiries(f, page),
    leadSources(),
    user.isAdmin ? teamMembers(true) : Promise.resolve([]),
    incomingTransfers(user.memberId),
  ]);
  const today = todayIST();
  const params = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v as string | undefined]));
  const exportHref = `/api/export/enquiries?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={user.isAdmin ? "All enquiries" : "Your claimed leads"}
        actions={
          <>
            <LinkButton href="/new-enquiry" variant="primary">+ New enquiry</LinkButton>
            <LinkButton href={exportHref} prefetch={false}>Export CSV</LinkButton>
          </>
        }
      />

      {incoming.length > 0 ? (
        <Card title={`Incoming transfers (${incoming.length})`} className="mb-4 border-cyan/50">
          <ul className="divide-y divide-line">
            {incoming.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/enquiries/${t.enquiry?.id}`} className="font-semibold hover:underline">{t.enquiry?.customer_name}</Link>
                  <span className="text-sm text-muted"> · {t.enquiry?.enq_code} · from {t.from?.name ?? "—"} · {t.enquiry?.requirement}</span>
                </span>
                <span className="flex gap-2">
                  <ActionButton action={respondTransfer} fields={{ transfer_id: t.id, accept: "true" }} label="Accept" variant="success" />
                  <ActionButton action={respondTransfer} fields={{ transfer_id: t.id, accept: "false" }} label="Decline" variant="secondary" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <FilterBar action="/pipeline">
        <FilterField label="Search" className="min-w-[200px] flex-1"><Input name="q" defaultValue={f.q} placeholder="Name, phone, product, ID…" /></FilterField>
        <FilterField label="Stage"><FilterSelect name="stage" value={f.stage} options={[{ value: "open", label: "All open" }, ...STAGES.map((x) => ({ value: x, label: x }))]} /></FilterField>
        <FilterField label="Follow-up"><FilterSelect name="follow" value={f.follow} options={[{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "upcoming", label: "Upcoming" }, { value: "none", label: "No date" }]} /></FilterField>
        <FilterField label="Priority"><FilterSelect name="priority" value={f.priority} options={PRIORITIES} /></FilterField>
        <FilterField label="Grade"><FilterSelect name="grade" value={f.grade} options={["A", "B", "C"]} /></FilterField>
        <FilterField label="Source"><FilterSelect name="source" value={f.source} options={sources} /></FilterField>
        {user.isAdmin ? (
          <FilterField label="Lead By"><FilterSelect name="owner" value={f.owner} options={[{ value: "unassigned", label: "Unassigned" }, ...team.map((t) => ({ value: t.id, label: t.name }))]} /></FilterField>
        ) : null}
        <FilterField label="State"><Input name="state" defaultValue={f.state} /></FilterField>
        <FilterField label="City"><Input name="city" defaultValue={f.city} /></FilterField>
        <FilterField label="From"><Input type="date" name="from" defaultValue={f.from} /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={f.to} /></FilterField>
        <FilterField label="Sort"><FilterSelect name="sort" value={f.sort} all="Newest first" options={[{ value: "oldest", label: "Oldest first" }, { value: "followup", label: "Next follow-up" }, { value: "value", label: "Highest value" }, { value: "customer", label: "Customer A–Z" }]} /></FilterField>
        {user.isAdmin ? (
          <FilterField label="Show"><FilterSelect name="view" value={f.view} all="Live" options={[{ value: "archived", label: "Archived" }, { value: "deleted", label: "Deleted" }]} /></FilterField>
        ) : null}
      </FilterBar>

      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No enquiries match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Enquiry</th><th>Customer</th><th>Requirement</th><th>Stage</th><th>Priority</th><th>Next follow-up</th>
                  {user.isAdmin ? <th>Lead By</th> : null}<th className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/enquiries/${e.id}`} className="font-semibold text-cyan-dk hover:underline">{e.enq_code}</Link>
                      <div className="text-xs text-muted">{niceDate(e.enq_date)} · {e.source}</div>
                    </td>
                    <td className="min-w-[160px]">
                      <div className="font-medium">{e.customer_name}</div>
                      <div className="text-xs text-muted">{[e.company, e.city].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="max-w-[260px]"><span className="line-clamp-2">{e.requirement}</span></td>
                    <td><StageBadge stage={e.stage} /> <GradeBadge grade={e.grade} /></td>
                    <td><PriorityBadge priority={e.priority} /></td>
                    <td className="whitespace-nowrap">
                      {e.next_follow_up ? <>{niceDate(e.next_follow_up)}<br /><FollowUpBadge date={e.next_follow_up} today={today} /></> : <span className="text-muted">—</span>}
                    </td>
                    {user.isAdmin ? <td>{e.owner?.name ?? <span className="text-muted">Unassigned</span>}</td> : null}
                    <td className="whitespace-nowrap text-right tabular-nums">{e.quote_amount ? inr(e.quote_amount) : e.est_value ? inr(e.est_value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3">
          <Pagination basePath="/pipeline" params={params} page={page} pageSize={25} total={total} />
        </div>
      </Card>
    </>
  );
}
