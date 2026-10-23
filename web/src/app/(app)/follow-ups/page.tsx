import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { PageHeader, Card, EmptyState } from "@/components/ui/layout";
import { GradeBadge, PriorityBadge, StageBadge } from "@/components/ui/badges";
import { niceDate } from "@/lib/domain/dates";
import { waLink } from "@/lib/domain/whatsapp";

export const metadata: Metadata = { title: "Follow-ups" };

type Item = {
  id: string; enq_code: string; customer_name: string; company: string; phone: string; stage: string; priority: string | null;
  grade: string | null; next_follow_up: string; last_contact: string | null; requirement: string; owner_name: string | null; days_overdue: number;
};

function List({ items, showOverdue }: { items: Item[]; showOverdue?: boolean }) {
  if (items.length === 0) return <EmptyState title="Nothing here 🎉" />;
  return (
    <ul className="divide-y divide-line">
      {items.map((e) => {
        const wa = waLink({ ...e, owner_name: e.owner_name }, "follow");
        return (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <Link href={`/enquiries/${e.id}`} className="font-semibold hover:underline">
                {e.customer_name}
              </Link>
              {e.company ? <span className="text-muted"> — {e.company}</span> : null}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{e.enq_code}</span>
                <StageBadge stage={e.stage} />
                <PriorityBadge priority={e.priority} />
                <GradeBadge grade={e.grade} />
                {e.owner_name ? <span>· {e.owner_name}</span> : null}
              </div>
              {e.requirement ? <p className="mt-0.5 line-clamp-1 text-[13px]">{e.requirement}</p> : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
              <span className={showOverdue ? "font-semibold text-red" : "text-muted"}>
                {showOverdue ? `${e.days_overdue} day(s) overdue` : niceDate(e.next_follow_up)}
              </span>
              <span className="flex gap-2">
                {e.phone ? <a className="text-cyan-dk hover:underline" href={`tel:${e.phone}`}>Call</a> : null}
                {wa ? <a className="text-green-dk hover:underline" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                <Link className="text-cyan-dk hover:underline" href={`/enquiries/${e.id}#log-call`}>Log call</Link>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function FollowUpsPage() {
  const user = await requireUser();
  const d = await readRpc<{ overdue: Item[]; today: Item[]; upcoming: Item[] }>("follow_ups_due");
  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle={`${user.isAdmin ? "All open leads" : "Your open leads"} · Hot every working day, Warm every 2, Cold every 6 (Sundays skipped)`}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title={`⚠ Overdue (${d.overdue.length})`} className="xl:col-span-1"><List items={d.overdue} showOverdue /></Card>
        <Card title={`● Due today (${d.today.length})`}><List items={d.today} /></Card>
        <Card title={`Upcoming (next ${d.upcoming.length})`}><List items={d.upcoming} /></Card>
      </div>
    </>
  );
}
