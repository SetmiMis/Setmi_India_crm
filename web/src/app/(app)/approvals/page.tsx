import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/server/auth";
import { leadSources, pendingList, recentReviewed, teamMembers } from "@/server/queries";
import { PageHeader, Card, EmptyState, Notice } from "@/components/ui/layout";
import { FilterBar, FilterField, sp } from "@/components/filter-bar";
import { Input } from "@/components/ui/form";
import { Pagination, pageFromParams } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/badges";
import { niceTimestamp } from "@/lib/domain/dates";
import { ReviewControls, PendingEditForm } from "./review-controls";

export const metadata: Metadata = { title: "Pending Approvals" };

const VIA: Record<string, string> = { staff: "New Enquiry", public_form: "Public form", bulk_import: "Bulk import", meta_import: "Meta Ads", legacy: "Legacy" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const s = await searchParams;
  const page = pageFromParams(s.page);
  const q = sp(s.q);
  const [{ rows, total }, team, sources, reviewed] = await Promise.all([pendingList(page, q), teamMembers(), leadSources(), recentReviewed(15)]);
  const teamOpts = team.map((t) => ({ id: t.id, name: t.name }));

  return (
    <>
      <PageHeader title="Pending Approvals" subtitle={user.isAdmin ? "Review every new lead before it enters the pipeline." : "Leads you submitted that are waiting for an admin."} />
      {!user.isAdmin ? <div className="mb-3"><Notice>Only admins approve or reject. You can still correct your own submissions while they are pending.</Notice></div> : null}
      <FilterBar action="/approvals">
        <FilterField label="Search" className="min-w-[220px] flex-1"><Input name="q" defaultValue={q} placeholder="Name, phone, company, product…" /></FilterField>
      </FilterBar>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Nothing waiting for review" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const g = (k: string) => (r[k] == null ? "" : String(r[k]));
              return (
                <li key={r.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_320px]">
                  <div className="min-w-0 text-sm">
                    <p className="text-base font-semibold">
                      {g("customer_name")} {g("company") ? <span className="font-normal text-muted">— {g("company")}</span> : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{r.pend_code}</span>
                      <Pill tone="info">{VIA[g("submitted_via")] ?? g("submitted_via")}</Pill>
                      <span>by {g("submitted_by_label") || "—"} · {niceTimestamp(g("created_at"))}</span>
                      {r.possible_duplicate ? <Pill tone="warn">Phone already known</Pill> : null}
                    </p>
                    <p className="mt-1">📞 {g("phone")} {g("email") ? `· ${g("email")}` : ""}</p>
                    <p>{[g("city"), g("district"), g("state"), g("pincode")].filter(Boolean).join(", ")}</p>
                    <p className="mt-1"><b>Requirement:</b> {g("requirement") || "—"} {g("qty") ? `· Qty ${g("qty")}` : ""} {g("timeline") ? `· ${g("timeline")}` : ""}</p>
                    <p className="text-xs text-muted">Source {g("source")} · Priority {g("priority") || "—"} · Lead By {r.owner?.name ?? "unassigned"}</p>
                    {g("notes") ? <p className="mt-1 whitespace-pre-wrap rounded bg-chip p-2 text-xs">{g("notes")}</p> : null}
                    {g("attachment_path") ? <a className="text-xs text-cyan-dk underline" href={`/api/attachments/pending/${r.id}`} target="_blank" rel="noopener noreferrer">View PDF</a> : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-cyan-dk">Correct fields</summary>
                      <div className="mt-2"><PendingEditForm row={r as Record<string, unknown> & { id: string }} sources={sources} team={teamOpts} /></div>
                    </details>
                  </div>
                  {user.isAdmin ? <ReviewControls id={r.id} defaultOwner={g("owner_id")} team={teamOpts} /> : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="px-4 pb-3"><Pagination basePath="/approvals" params={{ q }} page={page} pageSize={25} total={total} /></div>
      </Card>

      <Card title="Recently reviewed" className="mt-4">
        {reviewed.length === 0 ? <EmptyState title="No reviews yet" /> : (
          <ul className="space-y-1.5 text-sm">
            {reviewed.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-2">
                <span className="text-muted">{r.pend_code}</span>
                <span className="font-medium">{r.customer_name}</span>
                <Pill tone={r.status === "Approved" ? "good" : "bad"}>{r.status}</Pill>
                <span className="text-muted">by {r.reviewed_by_label || "—"} · {niceTimestamp(r.reviewed_at)}</span>
                {r.status === "Approved" && r.approved_enquiry_id ? <Link className="text-cyan-dk underline" href={`/enquiries/${r.approved_enquiry_id}`}>open</Link> : null}
                {r.reject_reason ? <span className="text-muted">· {r.reject_reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
