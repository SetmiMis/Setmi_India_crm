import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { readRpc } from "@/server/rpc";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui/layout";
import { FilterBar, FilterField, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { niceDate } from "@/lib/domain/dates";
import { waLink } from "@/lib/domain/whatsapp";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Available Leads" };

type Lead = {
  id: string; enq_code: string; customer_name: string; company: string; phone: string; city: string; requirement: string;
  source: string; enq_date: string; created_at: string; total: number;
};
const PAGE = 30;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const page = pageFromParams(s.page);
  const q = sp(s.q);
  const rows = await readRpc<Lead[]>("available_leads", { p_limit: PAGE, p_offset: (page - 1) * PAGE, p_q: q ?? null });
  const total = rows[0]?.total ?? 0;
  return (
    <>
      <PageHeader title="Available Leads" subtitle="Approved enquiries nobody owns yet. Call the customer, then claim the lead with the priority you judged." />
      {!user.memberId ? <div className="mb-3"><Notice tone="warn">Your login is not linked to a team member, so you cannot claim leads. Ask an admin.</Notice></div> : null}
      <FilterBar action="/leads">
        <FilterField label="Search" className="min-w-[220px] flex-1"><Input name="q" defaultValue={q} placeholder="Name, phone, city, product…" /></FilterField>
      </FilterBar>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No unclaimed leads right now">New approvals without a Lead By land here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((l) => {
              const wa = waLink({ customer_name: l.customer_name, phone: l.phone, requirement: l.requirement, owner_name: user.fullName }, "welcome");
              return (
                <li key={l.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {l.customer_name} {l.company ? <span className="font-normal text-muted">— {l.company}</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      {l.enq_code} · {l.source} · {niceDate(l.enq_date)} {l.city ? `· ${l.city}` : ""}
                    </p>
                    {l.requirement ? <p className="mt-1 text-sm">{l.requirement}</p> : null}
                    <p className="mt-1 flex gap-3 text-sm">
                      {l.phone ? <a href={`tel:${l.phone}`} className="font-semibold text-cyan-dk hover:underline">📞 {l.phone}</a> : null}
                      {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="text-green-dk hover:underline">WhatsApp</a> : null}
                    </p>
                  </div>
                  {user.memberId ? <ClaimForm id={l.id} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination basePath="/leads" params={{ q }} page={page} pageSize={PAGE} total={total} />
      </Card>
    </>
  );
}
